// goal: control an audio/video-separated page through the shipped full-document output owner
// inv: real toolbar admission and tabCapture; the signal oracle is the product graph's existing analyser
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CDPSession, Page } from 'puppeteer';
import type { ControlSnapshot } from '@nexus/contracts';
import { requireValue } from '../helpers/require-value';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	browser, closeActionPopup, evaluateServiceWorker, eventually, extensionId, fixtureUrl,
	getOffscreenTarget, getTabId, openExtensionClient, prepareSmokeSession, pressDefaultHotkeyFromContent,
	readBadgeText, startSmokeSession, teardownSmokeSession, waitForContentBootstrapStatus,
} from './harness';

describe('built extension document-output control', () => {
	beforeEach(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser({ ...options, ignoreDefaultArgs: ['--mute-audio'] }, {
			owner: 'apps/extension-spectra/test/smoke/document-output.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.each(['audio-reset', 'restore-page-settings'])('controls separate page audio and releases through %s', async releaseOperation => {
		const page = await browser.newPage();
		let popup: Page | null = null;
		let oracle: CDPSession | null = null;
		try {
			await page.goto(`${fixtureUrl}?document-output=1`, { waitUntil: 'domcontentloaded' });
			await page.evaluate(() => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				if (!video) throw new Error('Fixture video is missing');
				video.style.cssText = 'width:640px;height:360px';
				const canvas = document.createElement('canvas');
				canvas.width = 640; canvas.height = 360;
				const paint = canvas.getContext('2d');
				if (!paint) throw new Error('Canvas context is missing');
				paint.fillStyle = '#246'; paint.fillRect(0, 0, 640, 360);
				video.srcObject = canvas.captureStream(10);
				const start = document.createElement('button');
				start.id = 'start-separated-audio'; start.textContent = 'Start separate audio';
				start.onclick = () => {
					const context = new AudioContext();
					const oscillator = context.createOscillator();
					const amplitude = context.createGain();
					amplitude.gain.value = 0.05;
					oscillator.frequency.value = 1000;
					oscillator.connect(amplitude); amplitude.connect(context.destination);
					oscillator.start();
					void context.resume(); void video.play();
					start.dataset.started = 'true';
				};
				document.body.append(start);
			});
			await page.click('#start-separated-audio');
			await page.waitForFunction(() => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				return video && video.readyState >= 2 && !video.paused;
			});
			await waitForContentBootstrapStatus(page.url());
			const tabId = await getTabId(page.url());
			expect(await page.$eval('#v', element => {
				const tracks = (element as HTMLVideoElement).srcObject as MediaStream;
				return tracks.getTracks().map(track => track.kind);
			})).toEqual(['video']);
			await page.bringToFront();
			popup = await toolbarPopup(page);
			await popup.waitForSelector(`.glass-card[data-tab-id="${tabId}"] .vol-slider`);
			const samples: Record<string, number> = {};
			let analyserId = '';
			for (const value of [70, 30, 0, 100, 200]) {
				const actual = await sliderVolume(popup, tabId, value);
				expect(actual.fields.volumeBase?.strategy).toBe('capture');
				if (!oracle) {
					await setOutputObservation(tabId, true);
					oracle = await (await getOffscreenTarget()).createCDPSession();
				}
				await setOutputObservation(tabId, true);
				analyserId = await outputAnalyser(oracle);
				samples[String(value)] = await rms(oracle, analyserId);
			}
			if (!oracle) throw new Error('Product output oracle was not acquired');
			const unity = requireValue(samples['100'], 'The unity output sample is missing');
			expect(unity).toBeGreaterThan(0.01);
			for (const value of [30, 70, 200]) expect(requireValue(samples[String(value)], 'The output sample is missing') / unity)
				.toBeCloseTo(value / 100, 1);
			expect(samples['0']).toBeLessThan(0.000_001);

			for (const muted of [true, false]) {
				const response = await popup.evaluate(async ({ targetTabId, value }) => chrome.runtime.sendMessage({
					protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: targetTabId,
					payload: { tabId: targetTabId, source: 'popup', requestedCoverage: 'active-target', target: null, patch: { mediaMuted: value } },
				}), { targetTabId: tabId, value: muted });
				expect(response.ok).toBe(true);
				expect(response.data?.fields.mediaMuted?.actual).toBe(muted);
				await setOutputObservation(tabId, true);
				analyserId = await outputAnalyser(oracle);
				const level = await rms(oracle, analyserId);
				if (muted) expect(level).toBeLessThan(0.000_001);
				else expect(level / unity).toBeCloseTo(2, 1);
			}
			expect(await page.$eval('#v', element => ({ volume: (element as HTMLVideoElement).volume,
				muted: (element as HTMLVideoElement).muted }))).toEqual({ volume: 1, muted: false });
			await oracle.send('Runtime.releaseObjectGroup', { objectGroup: 'document-output-oracle' });
			await closeActionPopup(popup); popup = null;
			await page.bringToFront();
			await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
			await eventually(() => evaluateServiceWorker(async targetTabId => {
				const key = `spectra.control.tab.${targetTabId}`;
				return (await chrome.storage.local.get(key))[key] as { fields?: { volumeBase?: { actual?: number }; boost?: { actual?: number } } };
			}, tabId), snapshot => snapshot?.fields?.boost?.actual === 1.9, 'shortcut document-output ACK');
			await setOutputObservation(tabId, true);
			await oracle.send('HeapProfiler.collectGarbage');
			analyserId = await outputAnalyser(oracle);
			expect(await rms(oracle, analyserId) / unity).toBeCloseTo(1.9, 1);
			await setOutputObservation(tabId, false);
			await oracle.detach(); oracle = null;
			popup = await toolbarPopup(page);
			const released = await operation(popup, tabId, releaseOperation, {});
			if (!released.ok) throw new Error(`${releaseOperation}: ${JSON.stringify(released.error)}`);
			expect(released.ok).toBe(true);
			await closeActionPopup(popup); popup = null;
			await eventually(() => evaluateServiceWorker(async () => {
				const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] });
				if (contexts.length === 0) return [];
				const host = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_HOST_HELLO' });
				return host.audioTabs as unknown[];
			}), processors => processors.length === 0, 'document-output processor final release');
			expect(await originalTabRms(tabId)).toBeGreaterThan(0.01);
			console.log(JSON.stringify({ documentOutputRms: samples }));
		} finally {
			await oracle?.detach().catch(() => undefined);
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await page.close();
		}
	}, 60_000);

	test.skipIf(!process.env.SPECTRA_DOCUMENT_OUTPUT_LIVE_URL)('controls a public separated live output with the product graph oracle', async () => {
		const liveUrl = process.env.SPECTRA_DOCUMENT_OUTPUT_LIVE_URL?.trim();
		if (!liveUrl || new URL(liveUrl).protocol !== 'https:') throw new Error('A public HTTPS live room is required');
		const page = await browser.newPage();
		let popup: Page | null = null;
		let oracle: CDPSession | null = null;
		try {
			await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await eventually(() => page.evaluate(() => {
				const media = [...document.querySelectorAll<HTMLMediaElement>('video,audio')];
				const live = media.some(video => video.srcObject instanceof MediaStream
					&& video.srcObject.getAudioTracks().length === 0 && video.srcObject.getVideoTracks().length > 0
					&& !video.paused && video.currentTime > 25);
				// A loud pre-roll is not evidence that the broadcast is controlled.
				const noAudibleFiniteClip = media.every(video => !Number.isFinite(video.duration)
					|| video.paused || video.ended || video.muted || video.volume === 0);
				return live && noAudibleFiniteClip;
			}), ready => ready, 'playing video-only broadcast without an audible finite advertisement', 60_000);
			const tabId = await getTabId(page.url());
			popup = await toolbarPopup(page);
			const initial = await sliderVolume(popup, tabId, 70);
			expect(initial.fields.volumeBase?.strategy).toBe('capture');
			expect(initial.live).toBe(true);
			await setOutputObservation(tabId, true);
			oracle = await (await getOffscreenTarget()).createCDPSession();
			const samples: Record<string, number> = {};
			samples.baseline = await rms(oracle, await outputAnalyser(oracle));
			if (!(samples.baseline > 0.000_01)) {
				console.log(JSON.stringify({ silentLive: await page.evaluate(() => ({
					active: navigator.userActivation.hasBeenActive,
					media: [...document.querySelectorAll('video,audio')].map(node => ({
						id: node.id, muted: (node as HTMLMediaElement).muted, volume: (node as HTMLMediaElement).volume,
						paused: (node as HTMLMediaElement).paused, time: (node as HTMLMediaElement).currentTime,
					})),
					controls: [...document.querySelectorAll('[title],[aria-label],button')].map(node => ({
						tag: node.tagName, class: node.className, title: node.getAttribute('title'), aria: node.getAttribute('aria-label'),
					})).filter(node => /音|mute|volume/i.test(JSON.stringify(node))).slice(0, 20),
				})) }));
				throw new Error('The live programme has no nonzero product output baseline');
			}
			for (const value of [0, 70]) {
				await sliderVolume(popup, tabId, value);
				await setOutputObservation(tabId, true);
				const signal = await rms(oracle, await outputAnalyser(oracle));
				samples[`volume-${value}`] = signal;
				if (value === 0) expect(signal).toBeLessThan(0.000_001);
				else expect(signal).toBeGreaterThan(0.000_01);
			}
			for (const muted of [true, false]) {
				const response = await mediaMute(popup, tabId, muted);
				expect(response.data?.fields.mediaMuted?.actual).toBe(muted);
				await setOutputObservation(tabId, true);
				const signal = await rms(oracle, await outputAnalyser(oracle));
				samples[muted ? 'muted' : 'unmuted'] = signal;
				if (muted) expect(signal).toBeLessThan(0.000_001);
				else expect(signal).toBeGreaterThan(0.000_01);
			}
			await closeActionPopup(popup); popup = null;
			await page.bringToFront();
			// A fresh Alt+Up belongs to the manifest command; headless cannot dispatch
			// that accelerator, so drive the same control step through its envelope.
			await pressDefaultHotkeyFromContent(tabId, 'volume_up');
			await eventually(() => evaluateServiceWorker(async targetTabId => {
				const key = `spectra.control.tab.${targetTabId}`;
				return (await chrome.storage.local.get(key))[key] as { fields?: { volumeBase?: { actual?: number } } };
			}, tabId), snapshot => snapshot?.fields?.volumeBase?.actual === 80, 'live shortcut output ACK');
			await setOutputObservation(tabId, true);
			samples.shortcut = await rms(oracle, await outputAnalyser(oracle));
			expect(samples.shortcut).toBeGreaterThan(0.000_01);
			await setOutputObservation(tabId, false);
			await oracle.detach(); oracle = null;
			popup = await toolbarPopup(page);
			const released = await operation(popup, tabId, 'restore-page-settings', {});
			if (!released.ok) throw new Error(JSON.stringify(released.error));
			expect(released.ok).toBe(true);
			console.log(JSON.stringify({ host: new URL(liveUrl).host, productLiveOutputRms: samples }));
		} finally {
			await oracle?.detach().catch(() => undefined);
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await page.close();
		}
	}, 150_000);
});

async function sliderVolume(popup: Page, tabId: number, value: number): Promise<ControlSnapshot> {
	const selector = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
	await popup.waitForSelector(selector);
	const step = await popup.$eval(selector, element => Number((element as HTMLInputElement).step));
	if (!(step > 0) || value % step !== 0) throw new Error('Requested test level must match the real slider step');
	await popup.focus(selector);
	await popup.keyboard.press('Home');
	for (let index = 0; index < value / step; index++) await popup.keyboard.press('ArrowRight');
	const snapshot = await eventually(() => evaluateServiceWorker(async id => {
		const key = `spectra.control.tab.${id}`;
		return (await chrome.storage.local.get(key))[key] as ControlSnapshot | undefined;
	}, tabId), current => current?.fields.volumeBase?.phase === 'applied' && current.fields.boost?.phase === 'applied'
		&& Number(current.fields.volumeBase.actual) * Number(current.fields.boost.actual) === value,
		'actual slider input commits document output');
	if (!snapshot) throw new Error('Slider produced no snapshot');
	expect(await eventually(() => readBadgeText(tabId), text => text === (value === 0 ? 'M' : String(value)),
		'slider document output reaches badge')).toBe(value === 0 ? 'M' : String(value));
	return snapshot;
}

async function toolbarPopup(page: Page): Promise<Page> {
	await page.bringToFront();
	const known = new Set(browser.targets());
	const pending = browser.waitForTarget(target => !known.has(target)
		&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`));
	const session = await browser.target().createCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
		const tab = targetInfos.find(target => target.url === page.url());
		if (!tab) throw new Error('Fixture tab target is missing');
		await session.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
	} finally { await session.detach(); }
	return (await pending).asPage();
}

function operation(popup: Page, tabId: number, kind: string, payload: Record<string, unknown>) {
	return popup.evaluate(async ({ targetTabId, operation, value }) => chrome.runtime.sendMessage({
		protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.operation.submit', tabId: targetTabId,
		payload: { tabId: targetTabId, source: 'popup', target: null, operation, payload: value },
	}), { targetTabId: tabId, operation: kind, value: payload });
}

function mediaMute(popup: Page, tabId: number, muted: boolean) {
	return popup.evaluate(async ({ targetTabId, value }) => chrome.runtime.sendMessage({
		protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: targetTabId,
		payload: { tabId: targetTabId, source: 'popup', requestedCoverage: 'active-target', target: null, patch: { mediaMuted: value } },
	}), { targetTabId: tabId, value: muted });
}

async function setOutputObservation(tabId: number, enabled: boolean): Promise<void> {
	const response = await evaluateServiceWorker(async ({ targetTabId, on }) => chrome.runtime.sendMessage({
		target: 'offscreen', type: 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS', tabIds: on ? [targetTabId] : [],
	}), { targetTabId: tabId, on: enabled });
	if (!response || !Array.isArray(response.subscribedTabIds)) throw new Error('Output analyser subscription was not acknowledged');
}

async function outputAnalyser(session: CDPSession): Promise<string> {
	await session.send('Runtime.enable');
	await session.send('Runtime.releaseObjectGroup', { objectGroup: 'document-output-oracle' });
	const prototype = await session.send('Runtime.evaluate', { expression: 'AnalyserNode.prototype', objectGroup: 'document-output-oracle' });
	if (!prototype.result.objectId) throw new Error('Analyser prototype is unavailable');
	const objects = await session.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId, objectGroup: 'document-output-oracle' });
	const selected = await session.send('Runtime.callFunctionOn', {
		objectId: objects.objects.objectId, functionDeclaration: 'function() { const live = this.filter(node => node.context.state === "running"); if (live.length !== 1) throw new Error("Expected one live product output analyser, found " + live.length); return live[0]; }',
		objectGroup: 'document-output-oracle',
	});
	if (selected.exceptionDetails || !selected.result.objectId) throw new Error(
		selected.exceptionDetails?.exception?.description ?? 'Exactly one product output analyser is required');
	return selected.result.objectId;
}

async function rms(session: CDPSession, analyserId: string): Promise<number> {
	const result = await session.send('Runtime.callFunctionOn', {
		objectId: analyserId, awaitPromise: true, returnByValue: true,
		functionDeclaration: `async function() {
			if (this.context.state !== 'running') throw new Error('Output oracle belongs to a retired processor');
			await new Promise(resolve => setTimeout(resolve, 100));
			const data = new Float32Array(this.fftSize); let energy = 0;
			for (let frame = 0; frame < 12; frame++) {
				this.getFloatTimeDomainData(data); for (const value of data) energy += value * value;
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			if (this.context.state !== 'running') throw new Error('Output processor changed during the signal window');
			return Math.sqrt(energy / (12 * data.length));
		}`,
	});
	if (result.exceptionDetails || typeof result.result.value !== 'number') throw new Error('Product output signal read failed');
	return result.result.value;
}

async function originalTabRms(tabId: number): Promise<number> {
	const observer = await openExtensionClient('options.html');
	try {
		return await observer.evaluate(async targetTabId => {
			const id = await chrome.tabCapture.getMediaStreamId({ targetTabId });
			const stream = await navigator.mediaDevices.getUserMedia({ audio: {
				mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id },
			} as MediaTrackConstraints, video: false });
			const context = new AudioContext(); const analyser = context.createAnalyser();
			context.createMediaStreamSource(stream).connect(analyser); analyser.connect(context.destination);
			await context.resume();
			try {
				await new Promise(resolve => setTimeout(resolve, 150));
				const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
				return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
			} finally { for (const track of stream.getTracks()) track.stop(); await context.close(); }
		}, tabId);
	} finally { await observer.close(); }
}
