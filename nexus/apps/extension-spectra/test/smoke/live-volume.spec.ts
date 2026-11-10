// goal: verify native volume against a live tab's real audio, never property ACK alone
// inv: opt-in, isolated profile, production extension; no stored audio or capture stubs
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	browser, closeActionPopup, evaluateServiceWorker, eventually, extensionId, getTabId, openActionPopupTarget, readBadgeText,
	prepareSmokeSession, sendFromActionPopup, startSmokeSession, teardownSmokeSession, submitPopupControlIntent,
	waitForContentBootstrapStatus,
} from './harness';

interface SignalWindow extends Window {
	__spectraLiveSignal?: { stream: MediaStream; context: AudioContext; analyser: AnalyserNode };
}

const liveUrl = process.env.SPECTRA_LIVE_TEST_URL?.trim();

describe.skipIf(!liveUrl)('opt-in live volume signal', () => {
	beforeEach(async () => {
		if (!liveUrl || new URL(liveUrl).protocol !== 'https:') throw new Error('Set SPECTRA_LIVE_TEST_URL to a public HTTPS live room');
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser({
			...options,
			// Puppeteer's headless default silences the signal being measured.
			ignoreDefaultArgs: ['--mute-audio'],
		}, {
			owner: 'apps/extension-spectra/test/smoke/live-volume.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.skipIf(process.env.SPECTRA_LIVE_NATIVE_SIGNAL !== '1')('automatically restores native volume from the first live frames across refresh', async () => {
		if (!liveUrl) throw new Error('Live URL required');
		const page = await browser.newPage();
		const physical = () => page.evaluate(() => [...document.querySelectorAll('video')].map(video => ({
			volume: video.volume, muted: video.muted, paused: video.paused, time: video.currentTime,
			live: video.duration === Infinity,
			audio: video.srcObject instanceof MediaStream ? video.srcObject.getAudioTracks().length : 0,
		})));
		try {
			await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			// Seed the preference as soon as the real native audio source exists.
			// Refresh checks below do not acquire a runtime or submit a control.
			await eventually(physical, media => media.some(video => video.live && !video.paused && video.audio > 0),
				'first native live audio frame', 60_000);
			const tabId = await getTabId(liveUrl);
			const seed = await submitPopupControlIntent(tabId, { patch: { volumeBase: 40 } });
			if (!seed.ok) throw new Error(JSON.stringify(seed.error));
			await eventually(() => evaluateServiceWorker(async id => {
				const key = `tab_session_${id}`;
				return ((await chrome.storage.session.get(key))[key] as { patch?: { volumeBase?: number } })?.patch?.volumeBase;
			}, tabId), volume => volume === 40, 'native volume preference committed');
			for (let round = 0; round < 3; round++) {
				await page.bringToFront();
				await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
				const first = await eventually(physical, media => media.some(video => video.live && !video.paused
					&& video.volume === 0.4), 'first live volume restored automatically', 20_000);
				const settled = await eventually(physical, media => media.some(video => video.live && !video.paused
					&& video.audio > 0 && video.time > 1 && video.volume === 0.4), 'native volume survives audio track startup', 20_000);
				expect(settled.some(video => video.live && video.audio > 0 && video.volume === 0.4)).toBe(true);
				console.log(JSON.stringify({ coldRestoreRound: round, first, settled }));
			}
		} finally { await page.close(); }
	}, 120_000);

	test('the first real Popup slider gesture controls a cold live document', async () => {
		if (!liveUrl) throw new Error('Live URL is required');
		const page = await browser.newPage();
		try {
			await page.bringToFront();
			await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			const session = await page.createCDPSession();
			const mediaState = async () => {
				const result = await session.send('Runtime.evaluate', {
					expression: `JSON.stringify([...document.querySelectorAll('video,audio')].map(node => ({ id: node.id, volume: node.volume, muted: node.muted, paused: node.paused, time: node.currentTime, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))`,
					userGesture: false, returnByValue: true,
				});
				return JSON.parse(String(result.result.value)) as Array<{ id: string; volume: number; muted: boolean; paused: boolean; time: number; width: number; height: number }>;
			};
			try {
				await eventually(mediaState, nodes => nodes.some(node => !node.paused && node.time > 25), 'cold live playback', 60_000).catch(async error => {
					console.log(JSON.stringify({ title: await page.title(), text: await page.$eval('body', node => (node.textContent ?? '').slice(0, 3000)) }));
					throw error;
				});
				const tabId = await getTabId(liveUrl);
				const before = await mediaState();
				const knownTargets = new Set(browser.targets());
				const popupTarget = browser.waitForTarget(target => !knownTargets.has(target) && target.url().startsWith(`chrome-extension://${extensionId}/popup.html`));
				const invocation = await browser.target().createCDPSession();
				try {
					const { targetInfos } = await invocation.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
					const target = targetInfos.find(candidate => candidate.url === page.url());
					if (!target) throw new Error('Live tab is missing');
					await invocation.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
				} finally { await invocation.detach(); }
				const popup = await (await popupTarget).asPage();
				try {
					const selector = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
					await popup.waitForSelector(selector, { timeout: 15_000 });
					const bounds = await popup.$eval(selector, element => {
						const rect = element.getBoundingClientRect();
						return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
					});
					// First operation is a real pointer gesture. No control RPC, runtime
					// acquisition or signal-observer Capture has warmed this document.
					// triggerAction above is the actual toolbar invocation, unlike
					// action.openPopup(), which does not grant tabCapture admission.
					await popup.mouse.click(bounds.x + 8 + (bounds.width - 16) * 0.25, bounds.y + bounds.height / 2);
					await new Promise(resolve => setTimeout(resolve, 1500));
					const after = await mediaState();
					const ui = await popup.evaluate(() => ({
						values: [...document.querySelectorAll<HTMLInputElement>('.vol-slider')].map(node => ({ value: node.value, disabled: node.disabled })),
						text: document.body.textContent ?? '',
					}));
					console.log(JSON.stringify({ coldLive: new URL(liveUrl).host, before, after, ui }));
					expect(Number(ui.values[0]?.value)).toBeGreaterThan(100);
					expect(ui.text).not.toContain('failed');
					expect(ui.text).not.toContain('disconnected');
					expect(after.some(node => !node.paused)).toBe(true);
					const sliderValue = String(ui.values[0]?.value);
					const actualVolume = () => evaluateServiceWorker(async id => {
						const key = `spectra.control.tab.${id}`;
						const snapshot = (await chrome.storage.local.get(key))[key] as { fields?: {
							volumeBase?: { actual?: number; phase?: string }; boost?: { actual?: number; phase?: string };
						} } | undefined;
						const base = snapshot?.fields?.volumeBase;
						const boost = snapshot?.fields?.boost;
						return base?.phase === 'applied' && boost?.phase === 'applied'
							? Number(base.actual) * Number(boost.actual) : null;
					}, tabId);
					expect(await eventually(actualVolume, actual => actual === Number(sliderValue),
						'cold live slider has a committed actual')).toBe(Number(sliderValue));
					expect(await eventually(() => readBadgeText(tabId), text => text === sliderValue,
						'cold live slider reaches Action badge')).toBe(sliderValue);
					// Exercise the actual continuous UI transport below 100 as well:
					// the direct control RPC used by the signal test cannot prove this.
					await popup.focus(selector);
					await popup.keyboard.press('Home');
					expect(await eventually(actualVolume, actual => actual === 0, 'zero slider has a committed actual')).toBe(0);
					expect(await eventually(() => readBadgeText(tabId), text => text === 'M', 'zero slider reaches badge')).toBe('M');
					await popup.keyboard.press('ArrowRight');
					await eventually(async () => ({ value: await popup.$eval(selector, element => (element as HTMLInputElement).value),
						badge: await readBadgeText(tabId) }), state => Number(state.value) > 0 && state.badge === state.value,
						'restored live slider and badge agree');
					const restored = Number(await popup.$eval(selector, element => (element as HTMLInputElement).value));
					expect(await eventually(actualVolume, actual => actual === restored, 'restored slider has a committed actual')).toBe(restored);
				} finally { await closeActionPopup(popup); }
			} finally { await session.detach(); }
		} finally { await page.close(); }
	}, 100_000);

	// This oracle observes the original tab and therefore tests only the native
	// route. Capture output is measured by document-output.spec.ts after its graph.
	test.skipIf(process.env.SPECTRA_LIVE_NATIVE_SIGNAL !== '1')('native Popup and hotkey writes change the real tab output', async () => {
		if (!liveUrl) throw new Error('Live URL is required');
		const page = await browser.newPage();
		const observer = await browser.newPage();
		try {
			await page.bringToFront();
			await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await waitForContentBootstrapStatus(liveUrl);
			const tabId = await getTabId(liveUrl);
			const pageSession = await page.createCDPSession();
			try {
				await eventually(() => pageSession.send('Runtime.evaluate', {
					expression: "[...document.querySelectorAll('video,audio')].some(node => !node.paused && node.currentTime > 25)",
					userGesture: false, returnByValue: true,
				}), result => result.result.value === true, 'playing live media without page activation', 60_000).catch(async error => {
					console.log(JSON.stringify({ livePrecondition: await page.evaluate(() => ({
						title: document.title, text: (document.body.textContent ?? '').slice(0, 800),
						media: [...document.querySelectorAll('video,audio')].map(node => {
							const media = node as HTMLMediaElement;
							return { paused: media.paused, time: media.currentTime, ready: media.readyState, error: media.error?.code };
						}),
					})) }));
					throw error;
				});
			} finally { await pageSession.detach(); }
			const separatedOutput = await page.evaluate(() => [...document.querySelectorAll('video')].some(video =>
				!video.paused && video.currentTime > 25 && video.getBoundingClientRect().width > 0
				&& video.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().length > 0
				&& video.srcObject.getAudioTracks().length === 0));
			if (separatedOutput) throw new Error(
				'Native signal oracle cannot own tabCapture for a video-only live source; use the document-output product oracle');
			await page.bringToFront();
			const browserSession = await browser.target().createCDPSession();
			try {
				const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
				const target = targetInfos.find(candidate => candidate.url === page.url());
				if (!target) throw new Error('Live browser tab target was not returned');
				// Real browser extension invocation: do not stub tabCapture permission.
				await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
			} finally { await browserSession.detach(); }
			// Retire the invocation popup by moving to the observer tab, just as
			// opening a new tab does; keep the browser's granted tab capability.
			await observer.bringToFront();
			await observer.goto(`chrome-extension://${extensionId}/options.html`);
			await observer.evaluate(async (sourceTabId) => {
				const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: sourceTabId });
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
					video: false,
				});
				const context = new AudioContext();
				const analyser = context.createAnalyser();
				(window as SignalWindow).__spectraLiveSignal = { stream, context, analyser };
				context.createMediaStreamSource(stream).connect(analyser);
				await context.resume();
				if (context.state !== 'running') throw new Error('Signal observer did not start');
			}, tabId);
			const signal = () => observer.evaluate(async () => {
				const probe = (window as SignalWindow).__spectraLiveSignal;
				if (!probe) throw new Error('Signal observer is missing');
				// Drain the pre-write tab-capture buffer before sampling.
				await new Promise(resolve => setTimeout(resolve, 350));
				const data = new Float32Array(probe.analyser.fftSize);
				let square = 0;
				for (let frame = 0; frame < 20; frame++) {
					probe.analyser.getFloatTimeDomainData(data);
					for (const value of data) square += value * value;
					await new Promise(resolve => setTimeout(resolve, 50));
				}
				return Math.sqrt(square / (20 * data.length));
			});
			const samples: Record<string, number> = { initial: await signal() };
			const diagnostic = await page.createCDPSession();
			try {
				const media = await diagnostic.send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('video,audio')].map(node => ({ id: node.id, volume: node.volume, muted: node.muted, paused: node.paused, time: node.currentTime, srcObject: node.srcObject instanceof MediaStream ? node.srcObject.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled, muted: track.muted })) : null })))`, userGesture: false, returnByValue: true });
				console.log(JSON.stringify({ liveInitialSignal: samples.initial, media: media.result.value }));
			} finally { await diagnostic.detach(); }
			expect(samples.initial).toBeGreaterThan(0.000_01);
			await page.bringToFront();
			await sendFromActionPopup({
				protocolVersion: 2, tabId, type: 'spectra.control.operation.submit',
				payload: { tabId, source: 'popup', target: null, operation: 'effective-volume', payload: { operation: 'set', value: 70 } },
			});
			samples.baseline = await signal();
			if (!(samples.baseline > 0.000_01)) throw new Error('No audible live baseline; zero signal cannot certify volume control');
			await page.bringToFront();
			for (const value of [30, 70, 0]) {
				const response = await sendFromActionPopup<{ ok: boolean }>({
					protocolVersion: 2, tabId, type: 'spectra.control.operation.submit',
					payload: { tabId, source: 'popup', target: null, operation: 'effective-volume', payload: { operation: 'set', value } },
				});
				if (!response.ok) console.log(JSON.stringify({ liveVolumeFailure: response, value }));
				expect(response.ok).toBe(true);
				const rms = await signal();
				samples[`popup-${value}`] = rms;
				console.log(JSON.stringify({ value, rms, response }));
				if (value === 0) expect(rms).toBeLessThan(0.000_001);
				else expect(rms).toBeGreaterThan(0.000_01);
			}
			await page.bringToFront();
			await page.keyboard.down('Alt');
			await page.keyboard.press('ArrowUp');
			await page.keyboard.up('Alt');
			samples.hotkey = await signal();
			expect(samples.hotkey).toBeGreaterThan(0.000_01);
			const popup = await (await openActionPopupTarget()).asPage();
			try {
				const selector = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
				await popup.waitForSelector(selector, { timeout: 10_000 });
				await popup.focus(selector);
				await popup.keyboard.press('Home');
				samples.sliderZero = await signal();
				expect(samples.sliderZero).toBeLessThan(0.000_001);
				await popup.keyboard.press('ArrowRight');
				samples.sliderUp = await signal();
				expect(samples.sliderUp).toBeGreaterThan(0.000_01);
				// Fault only the optional preflight observation. The real slider,
				// native writer, physical audio and Action badge remain untouched.
				await evaluateServiceWorker(id => {
					const scope = globalThis as typeof globalThis & {
						__spectraVolumeReadFault?: { original: typeof chrome.tabs.sendMessage; count: number };
					};
					const fault = { original: chrome.tabs.sendMessage, count: 0 };
					scope.__spectraVolumeReadFault = fault;
					chrome.tabs.sendMessage = ((...args: unknown[]) => {
						const message = args[1] as { type?: string } | undefined;
						if (args[0] === id && message?.type === 'spectra.control.actual.read') {
							fault.count += 1;
							return Promise.reject(new Error('Injected optional volume observation failure'));
						}
						return Reflect.apply(fault.original, chrome.tabs, args);
					}) as typeof chrome.tabs.sendMessage;
				}, tabId);
				await popup.keyboard.press('Home');
				samples.failedReadSliderZero = await signal();
				expect(samples.failedReadSliderZero).toBeLessThan(0.000_001);
				expect(await eventually(() => readBadgeText(tabId), text => text === 'M', 'failed-read native mute badge')).toBe('M');
				await popup.keyboard.press('ArrowRight');
				samples.failedReadSliderUp = await signal();
				expect(samples.failedReadSliderUp).toBeGreaterThan(0.000_01);
				expect(await evaluateServiceWorker(() => (globalThis as typeof globalThis & {
					__spectraVolumeReadFault?: { count: number };
				}).__spectraVolumeReadFault?.count ?? 0)).toBeGreaterThanOrEqual(2);
			} finally {
				await evaluateServiceWorker(() => {
					const scope = globalThis as typeof globalThis & {
						__spectraVolumeReadFault?: { original: typeof chrome.tabs.sendMessage };
					};
					if (scope.__spectraVolumeReadFault) chrome.tabs.sendMessage = scope.__spectraVolumeReadFault.original;
					Reflect.deleteProperty(scope, '__spectraVolumeReadFault');
				});
				await closeActionPopup(popup);
			}
			console.log(JSON.stringify({ browser: await browser.version(), host: new URL(liveUrl).host, rms: samples }));
		} finally {
			await observer.evaluate(async () => {
				const probe = (window as SignalWindow).__spectraLiveSignal;
				if (!probe) return;
				for (const track of probe.stream.getTracks()) track.stop();
				await probe.context.close();
				delete (window as SignalWindow).__spectraLiveSignal;
			});
			await observer.close();
			await page.close();
		}
	}, 150_000);
});
