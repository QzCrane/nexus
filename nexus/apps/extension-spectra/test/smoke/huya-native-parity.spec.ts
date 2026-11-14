// goal: prove the shipped extension and Huya's own controls stay in sync in both directions
// inv: real-site gated case; real pointer input on the site's own widgets, real toolbar popup,
//      the shipped control snapshot and the page's own DOM are the only oracles
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CDPSession, Page } from 'puppeteer';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	browser, closeActionPopup, evaluateServiceWorker, eventually, extensionId, getTabId,
	prepareSmokeSession, readBadgeText, startSmokeSession, teardownSmokeSession,
} from './harness';

const SITE_SOUND_BUTTON = '#player-sound-btn';
const SITE_PLAY_BUTTON = '#player-btn';
const SITE_VOLUME_TRACK = '.sound-progress';
const SITE_VOLUME_HANDLE = '.sound-btn';
const SITE_VOLUME_BAR = '.sound-bar';

type SiteVolume = {
	barWidth: number;
	elementVolume: number;
	buttonClass: string;
	playTitle: string;
	paused: boolean;
};

describe('built extension Huya native control parity', () => {
	beforeEach(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser({ ...options, ignoreDefaultArgs: ['--mute-audio'] }, {
			owner: 'apps/extension-spectra/test/smoke/huya-native-parity.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.skipIf(!process.env.SPECTRA_HUYA_PARITY_URL)(
		'pauses without a readback mismatch and mirrors its volume to and from the site UI',
		async () => {
			const liveUrl = process.env.SPECTRA_HUYA_PARITY_URL?.trim();
			if (!liveUrl || new URL(liveUrl).protocol !== 'https:') throw new Error('A public HTTPS Huya room is required');
			const page = await browser.newPage();
			let popup: Page | null = null;
			let session: CDPSession | null = null;
			try {
				await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
				await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
				await new Promise(resolve => setTimeout(resolve, 30_000));
				const tabId = await getTabId(page.url());

				const readSite = (): Promise<SiteVolume> => page.evaluate(() => {
					const bar = document.querySelector('.sound-bar');
					const video = document.querySelector('#hy-video') as HTMLMediaElement | null;
					const sound = document.querySelector('#player-sound-btn');
					const play = document.querySelector('#player-btn');
					return { barWidth: bar?.getBoundingClientRect().width ?? 0,
						elementVolume: video?.volume ?? -1,
						buttonClass: sound?.className ?? '',
						playTitle: play?.getAttribute('title') ?? '',
						paused: video?.paused ?? true };
				});
				const readPlaying = () => evaluateServiceWorker(async id => {
					const key = `spectra.control.tab.${id}`;
					const snapshot = (await chrome.storage.local.get(key))[key];
					return snapshot?.fields?.playing ?? null;
				}, tabId);
				const readVolume = () => evaluateServiceWorker(async id => {
					const key = `spectra.control.tab.${id}`;
					const snapshot = (await chrome.storage.local.get(key))[key];
					return snapshot?.fields?.volumeBase ?? null;
				}, tabId);
				// The site's own controls must exist before any of the gestures below
				// can be treated as parity evidence.
				expect(await page.$eval(SITE_PLAY_BUTTON,
					button => button.getAttribute('title') ?? '')).toContain('暂停观看');
				expect(await page.$eval(SITE_VOLUME_BAR,
					bar => bar.getBoundingClientRect().width)).toBeGreaterThan(0);

				// Huya keeps its control bar below the initial viewport, reveals that
				// bar only while the pointer is over the player, and reveals the volume
				// slider only while the pointer is over the sound button. The gesture
				// sequence below is the one proven by the observation-only probe.
				await page.evaluate(() => window.scrollTo(0, 420));
				await new Promise(resolve => setTimeout(resolve, 700));
				const player = await page.$('#player-wrap');
				const playerBox = await player?.boundingBox();
				if (playerBox) {
					await page.mouse.move(playerBox.x + playerBox.width / 2,
						playerBox.y + playerBox.height / 2);
					await new Promise(resolve => setTimeout(resolve, 350));
				}
				await (await page.$(SITE_SOUND_BUTTON))?.hover();
				await new Promise(resolve => setTimeout(resolve, 900));

				// 1. Site -> extension: drag the site's own volume handle.
				const track = await page.$eval(SITE_VOLUME_TRACK, element => {
					const rect = element.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				});
				const handle = await page.$eval(SITE_VOLUME_HANDLE, element => {
					const rect = element.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				});
				expect(track.width).toBeGreaterThan(24);
				expect(handle.width).toBeGreaterThan(0);
				await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
				await page.mouse.down();
				await page.mouse.move(track.x + track.width * 0.2,
					handle.y + handle.height / 2, { steps: 10 });
				await page.mouse.up();
				await new Promise(resolve => setTimeout(resolve, 900));
				// A hidden control bar can swallow the drag on a cold player. A real
				// click on the track is the viewer's own fallback in that state.
				const afterDrag = await readSite();
				if (afterDrag.elementVolume <= 0 || afterDrag.elementVolume >= 0.45) {
					await page.mouse.click(track.x + track.width * 0.2, track.y + track.height / 2);
					await new Promise(resolve => setTimeout(resolve, 1200));
				}
				const siteAfterGesture = await eventually(readSite,
					value => value.elementVolume > 0 && value.elementVolume < 0.45,
					'Huya native volume gesture reaches the media element');
				const extensionAfterGesture = await eventually(readVolume,
					value => value?.phase === 'applied'
						&& Math.abs(Number(value.actual) - siteAfterGesture.elementVolume * 100) <= 3,
					'extension follows the site native volume gesture');
				expect(Number(extensionAfterGesture?.actual)).toBeGreaterThan(0);
				expect(Number(extensionAfterGesture?.actual)).toBeLessThan(45);

				// 2. Toolbar popup: pause must be acknowledged without a readback
				//    mismatch, and the site's own button must change with it.
				await page.bringToFront();
				const known = new Set(browser.targets());
				const pending = browser.waitForTarget(target => !known.has(target)
					&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`), { timeout: 20_000 });
				session = await browser.target().createCDPSession();
				const { targetInfos } = await session.send('Target.getTargets',
					{ filter: [{ type: 'tab', exclude: false }] });
				const tab = targetInfos.find(candidate => candidate.url === page.url());
				if (!tab) throw new Error('Huya tab target is missing');
				await session.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
				await session.detach(); session = null;
				popup = await (await pending).asPage();
				const card = `.glass-card[data-tab-id="${tabId}"]`;
				await popup.waitForSelector(`${card} .btn-pause`, { timeout: 20_000 });
				await popup.waitForFunction(selector => {
					const button = document.querySelector(`${selector} .btn-pause`);
					return button && button.getAttribute('aria-busy') !== 'true'
						&& button.getAttribute('aria-pressed') !== 'mixed';
				}, { timeout: 20_000 }, card).catch(() => undefined);

				await popup.click(`${card} .btn-pause`);
				const pausedState = await eventually(readPlaying,
					value => value?.actual === false, 'extension pause ACK is applied');
				expect(pausedState?.phase).toBe('applied');
				expect(pausedState?.lastError).toBeNull();
				const sitePaused = await eventually(readSite, value => value.paused,
					'Huya media element is paused');
				expect(sitePaused.playTitle).toContain('开始观看');

				await popup.click(`${card} .btn-pause`);
				const resumedState = await eventually(readPlaying,
					value => value?.actual === true, 'extension resume ACK is applied');
				expect(resumedState?.phase).toBe('applied');
				expect(resumedState?.lastError).toBeNull();
				await eventually(readSite, value => !value.paused, 'Huya media element resumes');

				// 3. Extension -> site: drive the shipped slider with real keys.
				const slider = `${card} .vol-slider`;
				const step = await popup.$eval(slider, element => Number((element as HTMLInputElement).step));
				expect(step).toBeGreaterThan(0);
				await popup.focus(slider);
				await popup.keyboard.press('Home');
				for (let index = 0; index < 70 / step; index += 1) await popup.keyboard.press('ArrowRight');
				const extensionAfterSlider = await eventually(readVolume,
					value => value?.phase === 'applied' && Math.abs(Number(value.actual) - 70) <= 6,
					'extension slider commits its own level');
				const siteAfterSlider = await eventually(readSite,
					value => Math.abs(value.elementVolume * 100 - 70) <= 6,
					'Huya native volume bar follows the extension slider');
				expect(siteAfterSlider.barWidth).toBeGreaterThan(50);
				expect(siteAfterSlider.barWidth).toBeLessThan(75);
				expect(await eventually(() => readBadgeText(tabId),
					text => Math.abs(Number(text) - Number(extensionAfterSlider?.actual)) <= 6,
					'badge shows the same level as the site and the slider')).toBeTruthy();
				expect(await popup.$eval(slider,
					element => Number((element as HTMLInputElement).value))).toBe(70);

				console.log(JSON.stringify({ huyaNativeParity: {
					url: page.url(), tabId,
					siteGesture: { elementVolume: siteAfterGesture.elementVolume,
						barWidth: siteAfterGesture.barWidth,
						extensionVolume: extensionAfterGesture?.actual },
					pause: { phase: pausedState?.phase, lastError: pausedState?.lastError,
						sitePaused: sitePaused.paused, playTitle: sitePaused.playTitle },
					resume: { phase: resumedState?.phase, lastError: resumedState?.lastError },
					extensionSlider: { extensionVolume: extensionAfterSlider?.actual,
						elementVolume: siteAfterSlider.elementVolume,
						barWidth: siteAfterSlider.barWidth },
				} }));
			} finally {
				await session?.detach().catch(() => undefined);
				if (popup) await closeActionPopup(popup).catch(() => undefined);
				await page.close();
			}
		}, 180_000);
});
