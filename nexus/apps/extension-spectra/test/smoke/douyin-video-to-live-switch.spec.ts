// goal: prove the shipped extension follows Douyin's own video -> live switch without a viewer gesture
// inv: real-site gated case only; the shipped control snapshot is the state oracle, never a fixture stand-in
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Page } from 'puppeteer';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	browser, closeActionPopup, evaluateServiceWorker, eventually, extensionId, getTabId,
	prepareSmokeSession, readBadgeText, startSmokeSession, teardownSmokeSession,
} from './harness';

type SwitchSample = { at: number; video: number; audio: number; duration: string; paused: boolean; volume: number };

const VOLUME_WIDGET = '.douyin-player-volume-number';

describe('built extension Douyin video-to-live switch', () => {
	beforeEach(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser({ ...options, ignoreDefaultArgs: ['--mute-audio'] }, {
			owner: 'apps/extension-spectra/test/smoke/douyin-video-to-live-switch.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.skipIf(!process.env.SPECTRA_DOUYIN_SWITCH_URL)(
		'keeps the live broadcast selected and its volume in sync without a gesture',
		async () => {
			const liveUrl = process.env.SPECTRA_DOUYIN_SWITCH_URL?.trim();
			if (!liveUrl || new URL(liveUrl).protocol !== 'https:') throw new Error('A public HTTPS Douyin page is required');
			const page = await browser.newPage();
			let popup: Page | null = null;
			try {
				await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
				// Record the site's own transition, not a synthetic element swap.
				await page.evaluateOnNewDocument(() => {
					// The portal replaces its document while switching. Keep the
					// observation in sessionStorage so the whole transition is one
					// timeline instead of only the last document's first frames.
					const key = '__spectraSwitchSamples';
					const tick = (): void => {
						try {
							const main = [...document.querySelectorAll('video')]
								.find(node => (node as HTMLVideoElement).srcObject) as HTMLVideoElement | undefined;
							if (main?.srcObject) {
								const stream = main.srcObject as MediaStream;
								const list: SwitchSample[] = JSON.parse(sessionStorage.getItem(key) ?? '[]');
								list.push({
									at: Date.now(),
									video: typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks().length : 0,
									audio: typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks().length : 0,
									duration: String(main.duration),
									paused: main.paused,
									volume: main.volume,
								});
								if (list.length > 500) list.shift();
								sessionStorage.setItem(key, JSON.stringify(list));
							}
						} catch (error) {
							// The sampler is evidence only: keep the reason so a
							// blocked storage never looks like a missing transition.
							(window as Window & { __switchSamplerError?: string }).__switchSamplerError = String(error);
						}
						setTimeout(tick, 100);
					};
					tick();
				});
				await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
				await eventually(() => page.evaluate(() => {
					const main = [...document.querySelectorAll('video')].find(node => (node as HTMLVideoElement).srcObject);
					if (!main) return false;
					const stream = (main as HTMLVideoElement).srcObject as MediaStream;
					return stream.getVideoTracks().length > 0 && stream.getAudioTracks().length > 0
						&& (main as HTMLVideoElement).duration === Number.POSITIVE_INFINITY
						&& !(main as HTMLVideoElement).paused;
				}), ready => ready, 'Douyin mounts a playing live stream with an audio track', 60_000);
				const tabId = await getTabId(page.url());
				// The site injects and removes a tiny hidden player a few seconds after
				// the switch. Stay completely passive through that whole window: no
				// popup, hotkey, snapshot write or control intent may rescue the state.
				await new Promise(resolve => setTimeout(resolve, 9_000));
				const samples = await page.evaluate(() => JSON.parse(
					sessionStorage.getItem('__spectraSwitchSamples') ?? '[]') as SwitchSample[]);
				const videoOnly = samples.filter(sample => sample.video > 0 && sample.audio === 0).length;
				const liveSamples = samples.filter(sample => sample.audio > 0 && sample.duration === 'Infinity').length;
				console.log(JSON.stringify({ switchSampler: {
					total: samples.length, first: samples.slice(0, 4), videoOnly, live: liveSamples,
				} }));
				expect(videoOnly).toBeGreaterThan(0);
				expect(liveSamples).toBeGreaterThan(0);
				const readState = () => evaluateServiceWorker(async id => {
					const key = `spectra.control.tab.${id}`;
					const snapshot = (await chrome.storage.local.get(key))[key];
					return snapshot ? {
						activeMedia: snapshot.activeMedia ?? null,
						live: snapshot.live ?? null,
						volumeBase: snapshot.fields?.volumeBase ?? null,
					} : null;
				}, tabId);
				const siteNumber = () => page.evaluate(selector =>
					Number(document.querySelector(selector)?.textContent?.trim()), VOLUME_WIDGET);
				const site = await siteNumber();
				expect(Number.isFinite(site)).toBe(true);
				const state = await readState();
				expect(state?.activeMedia).not.toBeNull();
				expect(state?.live).toBe(true);
				expect(state?.volumeBase?.phase).toBe('applied');
				expect(state?.volumeBase?.actual).toBe(site);

				// Only after the automatic state is proven may a real gesture run.
				popup = await toolbarPopup(page);
				const response = await popup.evaluate(async ({ id, value }) => chrome.runtime.sendMessage({
					protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: id,
					payload: { tabId: id, source: 'popup', requestedCoverage: 'active-target', target: null,
						patch: { volumeBase: value } },
				}), { id: tabId, value: 30 });
				expect(response.ok).toBe(true);
				expect(response.data?.fields.volumeBase?.actual).toBe(30);
				await eventually(siteNumber, value => value === 30, 'site native volume number follows the shipped control');
				expect(await page.evaluate(() => {
					const main = [...document.querySelectorAll('video')].find(node => (node as HTMLVideoElement).srcObject);
					return main ? (main as HTMLVideoElement).volume : null;
				})).toBeCloseTo(0.3, 2);
				expect(await eventually(() => readBadgeText(tabId), text => text === '30', 'switch badge')).toBe('30');
				console.log(JSON.stringify({
					douyinSwitch: {
						host: new URL(liveUrl).host, tabId, siteVolumeBeforeGesture: site,
						transitionSamples: samples.length,
						videoOnlyPhase: samples.filter(sample => sample.video > 0 && sample.audio === 0).length,
						livePhase: samples.filter(sample => sample.audio > 0 && sample.duration === 'Infinity').length,
						activeMediaBeforeGesture: state?.activeMedia,
						volumeBaseBeforeGesture: state?.volumeBase?.actual,
					},
				}));
			} finally {
				if (popup) await closeActionPopup(popup).catch(() => undefined);
				await page.close().catch(() => undefined);
			}
		}, 180_000);
});

async function toolbarPopup(page: Page): Promise<Page> {
	await page.bringToFront();
	const known = new Set(browser.targets());
	const pending = browser.waitForTarget(target => !known.has(target)
		&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`));
	const session = await browser.target().createCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
		const tab = targetInfos.find(target => target.url === page.url());
		if (!tab) throw new Error('Real-site tab target is missing');
		await session.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
	} finally { await session.detach(); }
	return (await pending).asPage();
}
