import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import type { Page } from 'puppeteer';
import { SPECTRA_CONTENT_RUNTIME_REVISION } from '@nexus/contracts';
import type { ControlSnapshot, SettingsSnapshot } from '@nexus/contracts';
import { SMOKE_TONE_WAV, browser, closeActionPopup, openActionPopupTarget, readBadgeColor, sendExtensionMessage, submitPopupControlIntent, evaluateServiceWorker, eventually, fixtureUrl, getTabId, hasOffscreenAudioTab, installSyntheticCaptureHarness, installTabCaptureStreamIdStub, openExtensionClient, pressDefaultHotkeyFromContent, readBadgeText, readContentBootstrapStatus, readContentStatus, readOsdFeedback, reinjectContentBootstrap, releaseSyntheticCapture, replaceHotkeySite, startOsdFeedbackProbe, tapDefaultShortcut, triggerDefaultHotkeyFromContent, waitForContentBootstrapStatus } from './harness';
import type { BootstrapListenerKey } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';
import { UI_COLORS } from '../../src/shared/ui-colors';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// `getComputedStyle` reports a resolved colour, so compare against the palette
// entry rather than a literal that can drift from it.
const cssColor = (hex: string): string => `rgb(${
	[
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	].join(', ')
})`;

describe('SPECTRA built extension smoke: hotkeys', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/hotkeys.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

test('keeps each OSD volume and tone together across older plans, ACKs and foreign routes', async () => {
	const bundled = await build({ entryPoints: [resolve(import.meta.dir, '../../src/content/ui/osd.ts')],
		bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SpectraOSD' });
	const code = bundled.outputFiles?.[0]?.text;
	if (!code) throw new Error('OSD component bundle missing');
	const page = await browser.newPage();
	try {
		await page.setContent('<main>Ordered OSD presentation</main>');
		await page.addScriptTag({ content: code });
		const traces = await page.evaluate(() => {
			const osd = (window as Window & { SpectraOSD: typeof import('../../src/content/ui/osd') }).SpectraOSD;
			const settings = { osdEnabled: true, visualizerEnabled: true, lang: 'en-US', osdMessages: { muted: 'MUTE' } };
			const read = () => {
				const root = document.getElementById('spectra-osd-host')?.shadowRoot;
				const fill = root?.getElementById('f');
				if (!fill) throw new Error('OSD fill missing');
				return { label: root?.getElementById('t')?.textContent, color: getComputedStyle(fill).backgroundColor };
			};
			const result: Record<string, ReturnType<typeof read>> = {};
			for (const sameGesture of [false, true]) {
				osd.hideOSD();
				const oldGesture = 'default:1'; const nextGesture = sameGesture ? oldGesture : 'default:2';
				const token = { owner: 'hotkey:default:1', revision: 1 };
				osd.advanceHotkeyTargetOSD({ kind: 'volume', value: 90, volumeState: 'native' }, 10, settings, oldGesture, () => 'native');
				osd.stageHotkeyVolumePresentation({ phase: 'pending', token, volume: 100, tone: 'native' }, settings, {}, oldGesture);
				osd.advanceHotkeyTargetOSD({ kind: 'volume', value: 100, volumeState: 'native' }, 10, settings, nextGesture, () => 'capture');
				result[`advance:${sameGesture}`] = read();
				osd.stageHotkeyVolumePresentation({ phase: 'pending', token, volume: 100, tone: 'native' }, settings, {}, oldGesture);
				result[`late-plan:${sameGesture}`] = read();
				osd.settleHotkeyVolumePresentation(token);
				osd.showHotkeyActualOSD({ kind: 'volume', value: 100, volumeState: 'native' }, settings, {}, oldGesture);
				result[`late-ack:${sameGesture}`] = read();
				if (sameGesture) {
					osd.freezeHotkeyTargetOSD(nextGesture);
					osd.releaseHotkeyTargetOSD(nextGesture);
					result.settled = read();
				}
			}
			osd.hideOSD();
			osd.showHotkeyActualOSD({ kind: 'volume', value: 110, volumeState: 'capture' }, settings,
				{ variant: 'alternate-target', targetTitle: 'Other tab' }, 'default:3');
			osd.freezeHotkeyTargetOSD('default:3'); osd.releaseHotkeyTargetOSD('default:3');
			osd.repaintHotkeyVolumeTone(() => 'native');
			result.alternate = read();
			osd.hideOSD();
			return result;
		});
		for (const [name, frame] of Object.entries(traces)) {
			expect(frame, name).toEqual(name === 'settled'
				? { label: '100%', color: cssColor(UI_COLORS.NATIVE) }
				: { label: '110%', color: cssColor(UI_COLORS.CAPTURE) });
		}
	} finally { await page.close(); }
}, 20_000);

	test('owns all five cold defaults once without exposing them to website handlers', async () => {
		const coldUrl = `${fixtureUrl}?cold-shortcut-tap=1`;
		const coldPage = await browser.newPage();
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		try {
			await coldPage.goto(coldUrl, { waitUntil: 'domcontentloaded' });
			const bootstrap = await waitForContentBootstrapStatus(coldUrl);
			const tabId = await getTabId(coldUrl);
			expect(bootstrap).toMatchObject({ ready: false, runtimeRevision: null });
			expect(await readBadgeText(tabId)).toBe('');
			await coldPage.evaluate(() => {
				const scope = window as Window & {
					__spectraWebsiteHotkeys?: { codes: string[]; reserveMute: boolean };
				};
				scope.__spectraWebsiteHotkeys = { codes: [], reserveMute: false };
				const websiteHotkeys = scope.__spectraWebsiteHotkeys;
				document.addEventListener('keydown', (event) => {
					if (!event.altKey
						|| !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyM']
							.includes(event.code)) return;
					websiteHotkeys.codes.push(event.code);
					if (event.code === 'KeyM' && websiteHotkeys.reserveMute) {
						event.preventDefault();
					}
				});
			});
			// A changed bootstrap revision must dispose the old capture arbiters.
			// The following physical keys therefore still execute exactly once.
			const replacement = await reinjectContentBootstrap(coldUrl, true);
			const expectedListenerOwnership: BootstrapListenerKey[] = [
				['document', 'durationchange', true],
				['document', 'emptied', true],
				['document', 'loadedmetadata', true],
				['document', 'loadstart', true],
				['document', 'pause', true],
				['document', 'play', true],
				['document', 'playing', true],
				['document', 'ratechange', true],
				['document', 'timeupdate', true],
				['document', 'visibilitychange', false],
				['document', 'volumechange', true],
				['window', 'blur', false],
				['window', 'keydown', true],
				['window', 'keyup', true],
				['window', 'pagehide', false],
				['window', 'pageshow', false],
			];
			expect(replacement).toMatchObject({ same: false });
			expect(replacement.listenerChanges).toEqual({
				added: expectedListenerOwnership,
				// The original document-start host also retires its one-shot readiness hook.
				removed: [['document', 'DOMContentLoaded', false], ...expectedListenerOwnership],
			});
			await waitForContentBootstrapStatus(coldUrl);

			await coldPage.bringToFront();
			await coldPage.evaluate(() => {
				document.body.tabIndex = -1;
				document.body.focus();
			});
			await coldPage.click('body');
			await coldPage.waitForFunction(() => (
				document.hasFocus() && document.activeElement === document.body
			));
			await coldPage.evaluate(async () => {
const media = document.querySelector<HTMLMediaElement>('video,audio');
if (media) {
media.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
await new Promise<void>((resolveReady) => {
if (media.readyState >= 2) return resolveReady();
media.addEventListener('canplay', () => resolveReady(), { once: true });
setTimeout(resolveReady, 500);
});
}
});
			// Chromium's headless Input domain does not deterministically dispatch a
			// browser-reserved extension accelerator to either commands.onCommand or
			// the renderer. The manifest/getAll assertion above owns that admission
			// seam; this isolated-world message is the exact accepted Content envelope
			// immediately after the trusted Alt+Up gate, with a real tab/document sender.
			await triggerDefaultHotkeyFromContent(tabId, 'volume_up');
			// Keep the invoking page foreground until Chrome admits the Capture
			// transition. readContentStatus acquires its lease through an Options
			// document, which would otherwise change the current-tab permission edge.
			await eventually(() => readBadgeText(tabId), (badge) => badge === '110', 'cold shortcut badge ACK');

			const applied = await eventually(
				async () => ({
					nativeVolume: await coldPage.evaluate(() => (
						Math.round((document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1) * 100)
					)),
					badge: await readBadgeText(tabId),
					bootstrap: await readContentBootstrapStatus(coldUrl),
					status: await readContentStatus(coldUrl),
				}),
				(state) => state.nativeVolume === 100
					&& state.badge === '110'
					&& state.bootstrap.ready
					&& state.status.config?.volume === 110
					&& state.status.config.volumeBase === 100
					&& state.status.config.boost === 1.1
					&& state.status.actualMode === 'webaudio',
				'cold first reserved volume key crosses the native 100 percent boundary',
				10_000,
			);
			expect(applied).toMatchObject({
				nativeVolume: 100,
				badge: '110',
				bootstrap: { ready: true, runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION },
				status: {
					config: { volume: 110, volumeBase: 100, boost: 1.1 },
					actualMode: 'webaudio',
				},
			});
			expect(await hasOffscreenAudioTab(tabId)).toBe(false);
			await tapDefaultShortcut(coldPage, 'ArrowDown');
			await eventually(
				async () => ({
					badge: await readBadgeText(tabId),
					status: await readContentStatus(coldUrl),
				}),
				(state) => state.status.config?.volume === 100
					&& state.status.config.boost === 1
					&& state.badge === '100',
				'cold volume-down acknowledgement after page WebAudio activation',
			);
			await tapDefaultShortcut(coldPage, 'ArrowLeft');
			await eventually(
				() => coldPage.evaluate(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
				)),
				(rate) => rate === 0.9,
				'cold speed-down acknowledgement',
			);
			await tapDefaultShortcut(coldPage, 'ArrowRight');
			await eventually(
				() => coldPage.evaluate(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
				)),
				(rate) => rate === 1,
				'cold speed-up acknowledgement',
			);
			await tapDefaultShortcut(coldPage, 'KeyM');
			await eventually(
				async () => ({
					muted: await coldPage.evaluate(() => (
						document.querySelector<HTMLMediaElement>('video,audio')?.muted
					)),
					osd: await coldPage.evaluate(() => (
						document.querySelector<HTMLElement>('#spectra-osd-host')
							?.shadowRoot?.getElementById('t')?.textContent
					)),
					badge: await readBadgeText(tabId),
				}),
				(state) => state.muted === true && state.osd === 'MUTE' && state.badge === 'M',
				'cold mute acknowledgement, OSD, and badge projection',
			);
			expect(await coldPage.evaluate(() => (
				(window as Window & {
					__spectraWebsiteHotkeys?: { codes: string[] };
				}).__spectraWebsiteHotkeys?.codes
			))).toEqual([]);
			await coldPage.evaluate(() => {
				const websiteHotkeys = (window as Window & {
					__spectraWebsiteHotkeys?: { reserveMute: boolean };
				}).__spectraWebsiteHotkeys;
				if (!websiteHotkeys) throw new Error('Website hotkey probe is missing');
				websiteHotkeys.reserveMute = true;
			});
			await tapDefaultShortcut(coldPage, 'KeyM');
			await eventually(
				() => coldPage.evaluate(() => ({
					muted: document.querySelector<HTMLMediaElement>('video,audio')?.muted,
					codes: (window as Window & {
						__spectraWebsiteHotkeys?: { codes: string[] };
					}).__spectraWebsiteHotkeys?.codes,
				})),
				(state) => state.muted === false && state.codes?.length === 0,
				'reserved mute remains extension-owned despite a website preventDefault handler',
			);
			expect(coldPage.url()).toBe(coldUrl);
		} finally {
			await releaseSyntheticCapture();
			await coldPage.close();
		}
	}, 30_000);

	test.each(['hotkey', 'popup', 'hotkey-pending'] as const)('paints the first Capture crossing purple before its writer ACK (%s)', async surface => {
		const hotkeySurface = surface !== 'popup';
		const baselineVolume = surface === 'hotkey-pending' ? 90 : 100;
		const targetUrl = new URL('/watch/42', fixtureUrl);
		targetUrl.hostname = 'localhost';
		targetUrl.search = `?capture-first-frame=${surface}`;
		const domain = targetUrl.hostname;
		const pathPrefix = targetUrl.pathname;
		const page = await browser.newPage();
		const settings = await openExtensionClient('popup.html');
		let popup: Page | null = null;
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		try {
			// A real user rule decides the route. No actual-mode/config/snapshot
			// fixture can stand in for the processor acknowledgement below.
			const rule = await sendExtensionMessage<{ ok: boolean }>(settings, {
				protocolVersion: 2, type: 'spectra.media-route.rules.upsert',
				payload: { domain, pathPrefix, route: 'capture' },
			});
			expect(rule.ok).toBe(true);
			await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded' });
			await page.bringToFront();
			await page.click('body');
			await page.evaluate(async bytes => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				if (!media) throw new Error('Fixture media is missing');
				media.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }));
				media.loop = true;
				media.muted = false;
				await media.play();
			}, [...SMOKE_TONE_WAV]);
			await waitForContentBootstrapStatus(page.url());
			const tabId = await getTabId(page.url());
			const baseline = await submitPopupControlIntent(tabId, {
				patch: { volumeBase: baselineVolume, boost: 1, mediaMuted: false },
			});
			expect(baseline.ok).toBe(true);
			await eventually(() => readContentStatus(page.url()), state => state.config?.volume === baselineVolume
				&& state.config.boost === 1 && state.actualMode !== 'capture', 'neutral native crossing baseline');
			const route = await evaluateServiceWorker(async id => {
				const [result] = await chrome.scripting.executeScript({
					target: { tabId: id }, world: 'ISOLATED',
					func: () => chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
						type: 'spectra.audio.route.get', payload: {} }),
				});
				return result?.result;
			}, tabId);
			expect(route).toMatchObject({ ok: true, data: { mediaRoute: 'capture', source: 'user' } });
			await page.bringToFront();
			if (hotkeySurface) {
				await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
				// The feedback surface is lazy. A speed gesture creates it without
				// ever crossing the audio boundary or activating Capture.
				await tapDefaultShortcut(page, 'ArrowRight');
				await eventually(() => readContentStatus(page.url()), state => state.config?.speed === 1.1,
					'non-volume feedback surface initialization');
				await page.waitForSelector('#spectra-osd-host');
				await submitPopupControlIntent(tabId, { patch: { speed: 1 } });
				await startOsdFeedbackProbe(page, '%');
			} else {
				popup = await (await openActionPopupTarget()).asPage();
				if (!popup) throw new Error('The real Action Popup did not expose a page');
				await popup.waitForFunction(id => {
					const card = document.querySelector<HTMLElement>(`.glass-card[data-tab-id="${id}"]`);
					return card?.dataset.controlCoverage === 'known'
						&& card.querySelector<HTMLInputElement>('.vol-slider')?.value === '100'
						&& card.querySelector('.vol-number')?.textContent === '100%';
				}, {}, tabId);
				await popup.evaluate(id => {
					const card = document.querySelector<HTMLElement>(`.glass-card[data-tab-id="${id}"]`);
					const slider = card?.querySelector<HTMLInputElement>('.vol-slider');
					const fill = card?.querySelector<HTMLElement>('.slider-fill');
					const label = card?.querySelector<HTMLElement>('.vol-number');
					if (!card || !slider || !fill || !label || slider.step !== '10') throw new Error('Volume projection is unavailable');
					const scope = window as Window & { __spectraCaptureFrames?: Array<{ label: string; color: string; labelColor: string }> };
					const frames: NonNullable<typeof scope.__spectraCaptureFrames> = [];
					scope.__spectraCaptureFrames = frames;
					const record = () => {
						if (label.textContent === '110%') frames.push({ label: label.textContent,
							color: getComputedStyle(fill).backgroundColor, labelColor: getComputedStyle(label).color });
					};
					// The post-handler input sample sees the very first synchronous
					// render; mutations then retain every later projection through ACK.
					slider.addEventListener('input', record);
					new MutationObserver(record).observe(card, { attributes: true,
						attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
				}, tabId);
				await popup.focus(`.glass-card[data-tab-id="${tabId}"] .vol-slider`);
			}

			await evaluateServiceWorker(({ id, holdNative }) => {
				const scope = globalThis as typeof globalThis & {
					__spectraCaptureWriterGate?: { original: typeof chrome.tabs.sendMessage;
						entered: boolean; forwarded: boolean; release: (() => void) | null;
						nativeEntered: boolean; releaseNative: (() => void) | null };
				};
				const gate: NonNullable<typeof scope.__spectraCaptureWriterGate> = {
					original: chrome.tabs.sendMessage, entered: false, forwarded: false, release: null,
					nativeEntered: false, releaseNative: null,
				};
				scope.__spectraCaptureWriterGate = gate;
				chrome.tabs.sendMessage = ((...args: unknown[]) => {
					const message = args[1] as { type?: string; payload?: { patch?: { boost?: number; volumeBase?: number } } } | undefined;
					if (holdNative && !gate.nativeEntered && args[0] === id && message?.type === 'spectra.control.intent.execute'
						&& message.payload?.patch?.volumeBase === 100 && message.payload.patch.boost === undefined) {
						gate.nativeEntered = true;
						return new Promise<void>(resolve => { gate.releaseNative = resolve; })
							.then(() => Reflect.apply(gate.original, chrome.tabs, args));
					}
					if (!gate.entered && args[0] === id && message?.type === 'spectra.control.intent.execute'
						&& Number(message.payload?.patch?.boost) > 1) {
						gate.entered = true;
						return new Promise<void>(resolve => { gate.release = resolve; }).then(() => {
							gate.forwarded = true;
							return Reflect.apply(gate.original, chrome.tabs, args);
						});
					}
					return Reflect.apply(gate.original, chrome.tabs, args);
				}) as typeof chrome.tabs.sendMessage;
			}, { id: tabId, holdNative: surface === 'hotkey-pending' });
			if (surface === 'hotkey-pending') {
				await pressDefaultHotkeyFromContent(tabId, 'volume_up');
				await eventually(() => evaluateServiceWorker(() => (globalThis as typeof globalThis & {
					__spectraCaptureWriterGate?: { nativeEntered: boolean };
				}).__spectraCaptureWriterGate?.nativeEntered), value => value === true, 'previous 100 percent write remains pending');
				// The pending projection lands before its writer ACK. The follow-up
				// gesture queues behind that unacknowledged write, so its own plan can
				// only be published once the native 100 percent settles.
				await eventually(
					async () => (await readOsdFeedback(page, 'volume')).frames.some(frame => frame.label === '100%'),
					projected => projected,
					'pending volume key projects its native target before the writer ACK',
				);
				await pressDefaultHotkeyFromContent(tabId, 'volume_up');
				await evaluateServiceWorker(() => (globalThis as typeof globalThis & {
					__spectraCaptureWriterGate?: { releaseNative: (() => void) | null };
				}).__spectraCaptureWriterGate?.releaseNative?.());
				await eventually(
					async () => (await readOsdFeedback(page, 'volume')).frames.filter(frame => frame.label === '110%'),
					frames => frames.length > 0,
					'queued volume key crosses 100 once the pending native write settles',
				);
			} else if (hotkeySurface) await pressDefaultHotkeyFromContent(tabId, 'volume_up');
			else if (popup) await popup.keyboard.press('ArrowRight');
			else throw new Error('The Action Popup is missing');
			await eventually(() => evaluateServiceWorker(() => {
				const gate = (globalThis as typeof globalThis & {
					__spectraCaptureWriterGate?: { entered: boolean; forwarded: boolean };
				}).__spectraCaptureWriterGate;
				return gate ? { entered: gate.entered, forwarded: gate.forwarded } : null;
			}), gate => gate?.entered === true && gate.forwarded === false, 'real Capture writer held before forwarding', 2_000);

			const purple = cssColor(UI_COLORS.CAPTURE);
			if (hotkeySurface) {
				const pending = await readOsdFeedback(page, 'volume');
				expect(pending.visible).toBe(true);
				const frames = pending.frames.filter(frame => frame.label === '110%');
				expect(frames[0]).toMatchObject({ label: '110%', color: purple });
				expect(frames.every(frame => frame.color === purple)).toBe(true);
			} else {
				if (!popup) throw new Error('The Action Popup is missing');
				const pending = await popup.evaluate(() => (window as Window & {
					__spectraCaptureFrames?: Array<{ label: string; color: string; labelColor: string }>;
				}).__spectraCaptureFrames ?? []);
				expect(pending[0]).toEqual({ label: '110%', color: purple, labelColor: purple });
				expect(pending.every(frame => frame.color === purple && frame.labelColor === purple)).toBe(true);
			}
			const expectedBadge = [...[1, 3, 5].map(offset => Number.parseInt(UI_COLORS.CAPTURE.slice(offset, offset + 2), 16)), 255];
			const pendingBadge = await eventually(async () => ({ text: await readBadgeText(tabId),
				color: await readBadgeColor(tabId) }), value => value.text === '110'
				&& value.color.every((channel, index) => channel === expectedBadge[index]), 'pending Capture badge number and tone', 1_000);
			expect(pendingBadge).toEqual({ text: '110', color: expectedBadge });
			// Re-check the gate after all surface reads: none of these values can
			// have come from a writer ACK that raced the presentation assertion.
			expect(await evaluateServiceWorker(() => (globalThis as typeof globalThis & {
				__spectraCaptureWriterGate?: { forwarded: boolean };
			}).__spectraCaptureWriterGate?.forwarded)).toBe(false);
			await evaluateServiceWorker(() => (globalThis as typeof globalThis & {
				__spectraCaptureWriterGate?: { release: (() => void) | null };
			}).__spectraCaptureWriterGate?.release?.());
			if (popup) await popup.$eval(`.glass-card[data-tab-id="${tabId}"] .vol-slider`, slider => {
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(() => readContentStatus(page.url()), state => state.config?.volume === 110
				&& state.config.boost === 1.1 && state.actualMode === 'capture' && state.phase === 'active', 'real Capture writer ACK');
			const committed = await eventually(() => evaluateServiceWorker(async id => {
				const key = `spectra.control.tab.${id}`;
				return (await chrome.storage.local.get(key))[key] as ControlSnapshot | undefined;
			}, tabId), value => value?.fields.boost?.phase === 'applied'
				&& value.fields.boost.actual === 1.1 && value.fields.boost.strategy === 'capture', 'committed Capture control ACK');
			expect(committed?.fields.volumeBase?.actual).toBe(100);
			expect(await hasOffscreenAudioTab(tabId)).toBe(true);
			if (hotkeySurface) {
				const settled = await readOsdFeedback(page, 'volume', true);
				const frames = settled.frames.filter(frame => frame.label === '110%');
				expect(frames[0]?.color).toBe(purple);
				expect(frames.every(frame => frame.color === purple)).toBe(true);
			} else {
				if (!popup) throw new Error('The Action Popup is missing');
				const settled = await popup.evaluate(() => (window as Window & {
					__spectraCaptureFrames?: Array<{ color: string; labelColor: string }>;
				}).__spectraCaptureFrames ?? []);
				expect(settled.length).toBeGreaterThan(0);
				expect(settled.every(frame => frame.color === purple && frame.labelColor === purple)).toBe(true);
			}
			expect(await readBadgeText(tabId)).toBe('110');
			expect(await readBadgeColor(tabId)).toEqual(expectedBadge);
		} finally {
			await evaluateServiceWorker(() => {
				const scope = globalThis as typeof globalThis & {
					__spectraCaptureWriterGate?: { original: typeof chrome.tabs.sendMessage; release: (() => void) | null; releaseNative?: (() => void) | null };
				};
				const gate = scope.__spectraCaptureWriterGate;
				if (gate) { chrome.tabs.sendMessage = gate.original; gate.releaseNative?.(); gate.release?.(); }
				delete scope.__spectraCaptureWriterGate;
			}).catch(() => undefined);
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await sendExtensionMessage(settings, { protocolVersion: 2, type: 'spectra.media-route.rules.remove',
				payload: { fingerprint: `site:${domain}${pathPrefix}` } }).catch(() => undefined);
			await settings.close();
			await page.close();
		}
	}, 35_000);

	test('owns reserved default hotkeys before website handlers without editable takeover or release tails', async () => {
		type ArbiterMode = 'document-stop' | 'observe' | 'repeat-stop' | 'window-prevent';
		interface ArbiterProbe {
			mode: ArbiterMode;
			documentStops: number;
			repeatStops: number;
			keyupStops: number;
			popstates: number;
			windowEvents: Array<{
				mode: ArbiterMode;
				code: string;
				defaultPrevented: boolean;
				repeat: boolean;
				target: string;
			}>;
		}
		const arbiterUrl = `${fixtureUrl}?hotkey-arbiter=1`;
		const arbiterPage = await browser.newPage();
		const readMedia = () => arbiterPage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
				?.shadowRoot?.getElementById('o');
			return {
				href: location.href,
				popstates: (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe?.popstates ?? 0,
				speed: media?.playbackRate ?? -1,
				volume: Math.round((media?.volume ?? -1) * 100),
				osd: osd?.querySelector<HTMLElement>('#t')?.textContent ?? '',
				osdVisible: osd?.classList.contains('v') ?? false,
			};
		});
		const setMode = (mode: ArbiterMode) => arbiterPage.evaluate((nextMode) => {
			const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
				.__spectraArbiterProbe;
			if (!probe) throw new Error('Default hotkey arbiter probe is missing');
			probe.mode = nextMode;
		}, mode);
		const focusBody = () => arbiterPage.evaluate(() => {
			document.body.tabIndex = -1;
			document.body.focus();
		});
		const waitForOsdToSettle = () => arbiterPage.waitForFunction(() => {
			const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
				?.shadowRoot?.getElementById('o');
			return osd !== null && osd !== undefined && !osd.classList.contains('v');
		}, { timeout: 3_500 });

		try {
			await arbiterPage.goto(arbiterUrl, { waitUntil: 'domcontentloaded' });
			const arbiterTabId = await getTabId(arbiterUrl);
			await arbiterPage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (media) {
					media.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
				}
			});
			expect(await waitForContentBootstrapStatus(arbiterUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
			});
			expect(await readMedia()).toMatchObject({ speed: 1, volume: 100 });
			await arbiterPage.evaluate(() => {
				const scope = window as Window & { __spectraArbiterProbe?: ArbiterProbe };
				const probe: ArbiterProbe = {
					mode: 'observe',
					documentStops: 0,
					repeatStops: 0,
					keyupStops: 0,
					popstates: 0,
					windowEvents: [],
				};
				scope.__spectraArbiterProbe = probe;
				const isDefault = (event: KeyboardEvent) => event.altKey
					&& ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyM']
						.includes(event.code);
				document.addEventListener('keydown', (event) => {
					if (!isDefault(event)) return;
					if (probe.mode === 'document-stop' && event.code === 'ArrowRight') {
						probe.documentStops += 1;
						event.stopPropagation();
					} else if (probe.mode === 'repeat-stop'
						&& event.code === 'ArrowDown'
						&& event.repeat) {
						probe.repeatStops += 1;
						event.stopPropagation();
					}
				});
				document.addEventListener('keyup', (event) => {
					if (probe.mode !== 'repeat-stop' || event.code !== 'ArrowDown') return;
					probe.keyupStops += 1;
					event.stopPropagation();
				});
				window.addEventListener('keydown', (event) => {
					if (!isDefault(event)) return;
					const origin = event.composedPath()[0];
					probe.windowEvents.push({
						mode: probe.mode,
						code: event.code,
						defaultPrevented: event.defaultPrevented,
						repeat: event.repeat,
						target: origin instanceof Element ? origin.id || origin.tagName : '',
					});
					if (probe.mode === 'window-prevent') event.preventDefault();
				});
				window.addEventListener('popstate', () => {
					probe.popstates += 1;
				});

				const container = document.createElement('div');
				container.style.cssText = 'position:fixed;left:-10000px;top:0';
				const input = document.createElement('input');
				input.id = 'arbiter-input';
				const textarea = document.createElement('textarea');
				textarea.id = 'arbiter-textarea';
				const select = document.createElement('select');
				select.id = 'arbiter-select';
				select.append(new Option('one', 'one'));
				const editable = document.createElement('div');
				editable.id = 'arbiter-contenteditable';
				editable.contentEditable = 'true';
				editable.tabIndex = 0;
				const shadowHost = document.createElement('div');
				shadowHost.id = 'arbiter-shadow-host';
				const shadowInput = document.createElement('input');
				shadowInput.id = 'arbiter-shadow-input';
				shadowHost.attachShadow({ mode: 'open' }).append(shadowInput);
				container.append(input, textarea, select, editable, shadowHost);
				document.body.append(container);
			});

			await focusBody();
			await setMode('window-prevent');
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				(state) => state.speed === 1.1 && state.osd === '1.1×' && state.osdVisible,
				'reserved speed key before a website preventDefault handler',
			);
			await waitForOsdToSettle();
			await setMode('document-stop');
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				// This step owns browser-history exclusion. OSD visibility duration is
				// proved by the dedicated top-layer test and may settle before a busy
				// extracted-package run observes the already-acknowledged speed value.
				(state) => state.speed === 1.2 && state.osd === '1.2×',
				'reserved speed key before a website propagation stop',
			);
			await waitForOsdToSettle();
			await setMode('observe');
			const editableTargets = [
				'arbiter-input',
				'arbiter-textarea',
				'arbiter-select',
				'arbiter-contenteditable',
				'arbiter-shadow-input',
			];
			for (const target of editableTargets) {
				expect(await arbiterPage.evaluate((targetId) => {
					const shadow = document.getElementById('arbiter-shadow-host')?.shadowRoot;
					const element = targetId === 'arbiter-shadow-input'
						? shadow?.getElementById(targetId)
						: document.getElementById(targetId);
					if (!(element instanceof HTMLElement)) return false;
					element.focus();
					return targetId === 'arbiter-shadow-input'
						? shadow?.activeElement === element
						: document.activeElement === element;
				}, target)).toBe(true);
				await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			}
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				(state) => state.speed === 1.3 && state.osd === '1.3×' && state.osdVisible,
				'three reserved speed keys before website handlers and editable exclusions',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.3, volume: 100 });

			const exclusionProbe = await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return probe;
			});
			expect(exclusionProbe.documentStops).toBe(0);
			expect(exclusionProbe.windowEvents
				.filter(({ target }) => editableTargets.includes(target))
				.map(({ target }) => target)).toEqual(editableTargets);
			expect(exclusionProbe.windowEvents).toHaveLength(editableTargets.length);

			const historyUrl = await arbiterPage.evaluate(() => {
				history.pushState({ spectraArbiter: true }, '', `${location.pathname}${location.search}#entry`);
				return location.href;
			});
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowLeft');
			await eventually(
				readMedia,
				// The dedicated top-layer test owns presentation duration. Here the
				// acknowledged speed and retained label prove command acceptance while
				// the URL/popstate assertions below prove browser-history exclusion.
				(state) => state.speed === 1.2 && state.osd === '1.2×',
				'accepted Alt+Left speed without history traversal',
			);
			await waitForOsdToSettle();
			expect(arbiterPage.url()).toBe(historyUrl);
			expect(await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return probe.popstates;
			})).toBe(0);

			await setMode('repeat-stop');
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowDown');
			await eventually(
				readMedia,
				(state) => state.volume === 90 && state.osd === '90%' && state.osdVisible,
				'reserved volume key before website handlers',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.2, volume: 90 });
			expect(await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return {
					repeatStops: probe.repeatStops,
					keyupStops: probe.keyupStops,
				};
			})).toEqual({ repeatStops: 0, keyupStops: 0 });

			await setMode('observe');
			await pressDefaultHotkeyFromContent(arbiterTabId, 'volume_up');
			await eventually(
				readMedia,
				(state) => state.volume === 100 && state.osd === '100%' && state.osdVisible,
				'next volume key after truncated release',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.2, volume: 100 });
			await startOsdFeedbackProbe(arbiterPage, '%');
			await pressDefaultHotkeyFromContent(arbiterTabId, 'volume_up');
			const immediateFeedback = await eventually(
				() => readOsdFeedback(arbiterPage, 'volume'),
				(feedback) => feedback.frames[0]?.label === '110%',
				'next volume key paints its projected frame',
			);
			expect(immediateFeedback.frames[0]?.label).toBe('110%');
			expect(immediateFeedback.visible).toBe(true);
			// The fill colour is part of the same frame as the number. A document
			// whose sources the media graph covers amplifies without hijacking the
			// tab, so the crossing must never paint the Capture tone at all.
			expect(immediateFeedback.frames[0]?.color).toBe(cssColor(UI_COLORS.NATIVE));
			await eventually(
				async () => ({
					status: await readContentStatus(historyUrl),
					media: await readMedia(),
				}),
				(state) => state.status.config?.volume === 110
					&& state.status.config.boost === 1.1
					&& state.media.volume === 100
					&& state.media.osd === '110%',
				'first reserved volume key crosses the native 100 percent boundary',
			);
			const settledFeedback = await readOsdFeedback(arbiterPage, 'volume', true);
			// One tone for the whole presentation: the route that settled behind the
			// gesture agrees with the tone the gesture predicted, so there is no
			// correction frame and nothing to flicker.
			expect(settledFeedback.color).toBe(cssColor(UI_COLORS.NATIVE));
			expect(settledFeedback.frames.map((frame) => frame.color))
				.toEqual(settledFeedback.frames.map(() => cssColor(UI_COLORS.NATIVE)));
		} finally {
			await arbiterPage.keyboard.up('ArrowDown').catch(() => undefined);
			await arbiterPage.keyboard.up('Alt').catch(() => undefined);
			await arbiterPage.close();
		}
	}, 35_000);

	test('arbitrates configured site hotkeys website-first and releases a truncated keyup', async () => {
		type SiteArbiterMode =
			| 'document-stop'
			| 'observe'
			| 'window-keyup-stop'
			| 'window-prevent';
		interface SiteArbiterProbe {
			mode: SiteArbiterMode;
			documentStops: number;
			keyupStops: number;
			unclaimedWindowEvents: string[];
		}
		const siteDomain = 'localhost';
		const siteUrl = new URL(fixtureUrl);
		siteUrl.hostname = siteDomain;
		siteUrl.search = '?configured-site-hotkey-arbiter=1';
		const targetUrl = siteUrl.toString();
		const client = await openExtensionClient('options.html');
		let hotkeyPage: Page | null = null;
		let originalSite: SettingsSnapshot['hotkeySettings']['sites'][string] | null = null;
		let originalSiteCaptured = false;
		try {
			const configured = await replaceHotkeySite(client, siteDomain, {
					enabled: true,
					bindings: [{
						id: 'smoke-configured-site-speed',
						enabled: true,
						key: {
							code: 'KeyK',
							modifiers: {
								ctrl: false, alt: false, shift: false, meta: false,
							},
						},
						action: 'speed_up',
						params: { step: 0.1 },
					}],
			});
			originalSite = configured.previous.hotkeySettings.sites[siteDomain] ?? null;
			originalSiteCaptured = true;

			const page = await browser.newPage();
			hotkeyPage = page;
			await page.evaluateOnNewDocument(() => {
				const scope = window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe };
				const probe: SiteArbiterProbe = {
					mode: 'observe',
					documentStops: 0,
					keyupStops: 0,
					unclaimedWindowEvents: [],
				};
				scope.__spectraSiteArbiterProbe = probe;
				const isCandidate = (event: KeyboardEvent) => (
					event.code === 'KeyK'
					&& !event.ctrlKey
					&& !event.altKey
					&& !event.shiftKey
					&& !event.metaKey
				) || event.altKey
					&& event.code === 'ArrowRight';
				document.addEventListener('keydown', (event) => {
					if (!isCandidate(event)
						|| probe.mode !== 'document-stop'
						|| event.code !== 'KeyK') return;
					probe.documentStops += 1;
					event.stopPropagation();
				});
				window.addEventListener('keyup', (event) => {
					if (probe.mode !== 'window-keyup-stop' || event.code !== 'KeyK') return;
					probe.keyupStops += 1;
					event.stopImmediatePropagation();
				}, true);
				window.addEventListener('keydown', (event) => {
					if (!isCandidate(event)) return;
					if (!event.defaultPrevented) {
						probe.unclaimedWindowEvents.push(
							`${probe.mode}:${event.code}:${event.repeat}`,
						);
					}
					if (probe.mode === 'window-prevent' && event.code === 'KeyK') {
						event.preventDefault();
					}
				});
			});
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
			await eventually(
				() => evaluateServiceWorker(async (configuredUrl) => {
					const tab = (await chrome.tabs.query({})).find(
						(candidate) => candidate.url === configuredUrl,
					);
					if (tab?.id === undefined) return null;
					const [inspection] = await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						world: 'ISOLATED',
						func: () => {
							const marker = (window as Window & {
								__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: {
									revision?: unknown;
									active?: unknown;
								};
							}).__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
							return { revision: marker?.revision, active: marker?.active };
						},
						});
						return inspection?.result ?? null;
					}, targetUrl),
				(marker) => marker?.revision === 2 && marker.active === true,
				'configured site lean hotkey host',
				15_000,
			);
			const tabId = await getTabId(targetUrl);
			await page.bringToFront();

			const focusBody = () => page.evaluate(() => {
				document.body.tabIndex = -1;
				document.body.focus();
			});
			const setMode = (mode: SiteArbiterMode) => page.evaluate((nextMode) => {
				const probe = (window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe })
					.__spectraSiteArbiterProbe;
				if (!probe) throw new Error('Configured site hotkey arbiter probe is missing');
				probe.mode = nextMode;
			}, mode);
			const readState = () => page.evaluate(() => {
				const probe = (window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe })
					.__spectraSiteArbiterProbe;
				if (!probe) throw new Error('Configured site hotkey arbiter probe is missing');
				return {
					speed: document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? -1,
					probe,
				};
			});
			const readControlSnapshot = () => client.evaluate(
				async (targetTabId) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				}),
				tabId,
			) as Promise<{
				ok: boolean;
				data?: ControlSnapshot;
				error?: { message?: string };
			}>;
			const waitForHotkeyFeedbackWindow = async () => {
				await page.waitForFunction(() => {
					const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o');
					return osd?.classList.contains('v') === true;
				}, { timeout: 3_500 });
				await page.waitForFunction(() => {
					const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o');
					return osd !== null && osd !== undefined && !osd.classList.contains('v');
				}, { timeout: 3_500 });
			};
			const tapSiteHotkey = async () => {
				await page.keyboard.press('KeyK');
			};

			expect(await readState()).toMatchObject({ speed: 1 });
			await focusBody();
			for (const mode of ['window-prevent', 'document-stop'] as const) {
				await setMode(mode);
				await tapSiteHotkey();
				await new Promise((resolveWait) => setTimeout(resolveWait, 25));
				expect(await readState()).toMatchObject({ speed: 1 });
			}

			await setMode('observe');
			await tapSiteHotkey();
			await eventually(
				readState,
				(state) => state.speed === 1.1,
				'one accepted configured site hotkey',
			);
			await waitForHotkeyFeedbackWindow();
			expect(await readState()).toMatchObject({ speed: 1.1 });

			// Enabling a site-specific listener must not duplicate ownership of
			// the five shipped chords that remain bootstrap-owned.
			await tapDefaultShortcut(page, 'ArrowRight');
			await eventually(
				readState,
				(state) => state.speed === 1.2,
				'one default hotkey despite a colliding site binding',
			);
			await waitForHotkeyFeedbackWindow();
			expect(await readState()).toMatchObject({ speed: 1.2 });

			await setMode('window-keyup-stop');
			await page.keyboard.down('KeyK');
			await eventually(
				async () => ({
					page: await readState(),
					snapshot: await readControlSnapshot(),
				}),
				(state) => state.page.speed === 1.3
					&& state.snapshot.ok
					&& state.snapshot.data?.fields.speed?.phase === 'applied'
					&& state.snapshot.data.fields.speed.actual === 1.3,
				'acknowledged configured site hotkey initial held press',
			);
			// The canonical snapshot can become observable before the original
			// Content-side sendMessage promise runs its settlement microtask.
			// Wait for that gesture's owned feedback window instead of assuming
			// a fixed delay means its sole in-flight transaction has retired.
			await waitForHotkeyFeedbackWindow();
			await page.keyboard.down('KeyK');
			await eventually(
				readState,
				(state) => state.speed === 1.4,
				'one physical configured repeat before truncated release',
			);
			await page.keyboard.up('KeyK');
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
			expect(await readState()).toMatchObject({ speed: 1.4 });

			await setMode('observe');
			await tapSiteHotkey();
			await eventually(
				readState,
				(state) => state.speed === 1.5,
				'next configured site hotkey after truncated release',
			);
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
			const final = await readState();
			expect(final.speed).toBe(1.5);
			expect(final.probe.documentStops).toBe(1);
			expect(final.probe.keyupStops).toBe(1);
			expect(final.probe.unclaimedWindowEvents.some(
				(event) => event.startsWith('document-stop:'),
			)).toBe(false);
			expect(final.probe.unclaimedWindowEvents).toContain('window-prevent:KeyK:false');
			expect(final.probe.unclaimedWindowEvents).toContain('observe:KeyK:false');
			expect(final.probe.unclaimedWindowEvents.some(
				(event) => event.includes(':ArrowRight:'),
			)).toBe(false);
		} finally {
			await hotkeyPage?.keyboard.up('KeyK').catch(() => undefined);
			await hotkeyPage?.keyboard.up('Alt').catch(() => undefined);
			await hotkeyPage?.close().catch(() => undefined);
			try {
				if (originalSiteCaptured) {
					await replaceHotkeySite(client, siteDomain, originalSite);
				}
			} finally {
				await client.close().catch(() => undefined);
			}
		}
	}, 30_000);
});
