// goal: explain a real-site control verdict with the shipped extension's own RPC truth
// inv: observation only; no product source is modified and no control behaviour is added
// usage: NEXUS_CHROME_EXECUTABLE="..." SPECTRA_PROBE_LIVE_URL="https://..." bun scripts/probe-live-control.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LIVE_URL = process.env.SPECTRA_PROBE_LIVE_URL?.trim();
if (!LIVE_URL) throw new Error('SPECTRA_PROBE_LIVE_URL is required');
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const WAIT_MS = Number(process.env.SPECTRA_PROBE_WAIT_MS ?? 32_000);
const VOLUME = Number(process.env.SPECTRA_PROBE_VOLUME ?? 70);

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js', 'content-page-media-bridge.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	const bytes = await readFile(join(DIST, file));
	hashes[file] = createHash('sha256').update(bytes).digest('hex');
}

const profile = await mkdtemp(join(tmpdir(), 'spectra-live-control-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	enableExtensions: true,
	ignoreDefaultArgs: ['--mute-audio'],
	userDataDir: profile,
	args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1', '--window-size=1280,960'],
});

let worker;
let popup;
let page;
const out = {
	capturedAt: new Date().toISOString(),
	liveUrl: LIVE_URL,
	chrome: CHROME,
	dist: hashes,
	waitMs: WAIT_MS,
	settledVolume: VOLUME,
	steps: {},
	errors: [],
};
try {
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(() => undefined);
	const workerTarget = await browser.waitForTarget(target => target.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()), { timeout: 30_000 });
	out.extensionId = new URL(workerTarget.url()).host;
	worker = await workerTarget.worker();

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await new Promise(resolveTimer => setTimeout(resolveTimer, WAIT_MS));

	out.steps.pageWorld = await page.evaluate(() => ({
		url: location.href,
		title: document.title,
		media: [...document.querySelectorAll('video,audio')].map(element => {
			const node = /** @type {HTMLMediaElement} */ (element);
			const stream = node.srcObject;
			const rect = node.getBoundingClientRect();
			return {
				tag: node.tagName, id: node.id, className: String(node.className).slice(0, 100),
				src: (node.currentSrc || node.src || '').slice(0, 180),
				stream: stream ? {
					videoTracks: stream.getVideoTracks?.().length ?? null,
					audioTracks: stream.getAudioTracks?.().length ?? null,
				} : null,
				paused: node.paused, currentTime: node.currentTime, duration: node.duration,
				volume: node.volume, muted: node.muted, readyState: node.readyState,
				visibleArea: Math.max(0, rect.width) * Math.max(0, rect.height),
				dataset: { ...node.dataset },
			};
		}),
	}));

	const identity = await worker.evaluate(async url => {
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find(candidate => candidate.url === url);
		if (!tab?.id) throw new Error('Live tab not found');
		const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
		return { tabId: tab.id, documentId: frames?.find(frame => frame.frameId === 0)?.documentId ?? null,
			frameCount: frames?.length ?? 0 };
	}, page.url());
	out.steps.identity = identity;
	const { tabId, documentId } = identity;

	out.steps.isolatedWorld = await worker.evaluate(async id => {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: id, frameIds: [0] }, world: 'ISOLATED',
			func: async () => ({
				mediaStreamGlobal: typeof MediaStream,
				intersectionGeometry: await Promise.all([...document.querySelectorAll('video')].map(element =>
					new Promise(resolve => {
						const observer = new IntersectionObserver(entries => {
							const entry = entries[0];
							observer.disconnect();
							resolve({
								id: /** @type {HTMLMediaElement} */ (element).id,
								isIntersecting: entry.isIntersecting,
								intersectionArea: entry.intersectionRect.width * entry.intersectionRect.height,
								boundingArea: entry.boundingClientRect.width * entry.boundingClientRect.height,
								boundingBox: { x: entry.boundingClientRect.x, y: entry.boundingClientRect.y,
									width: entry.boundingClientRect.width, height: entry.boundingClientRect.height },
								viewport: { width: innerWidth, height: innerHeight },
								visibilityState: document.visibilityState,
							});
						});
						observer.observe(element);
						setTimeout(() => { observer.disconnect(); resolve({ id: element.id, timeout: true }); }, 1200);
					}))),
				runtimeDigest: (() => {
					const runtime = /** @type {any} */ (window).__SPECTRA_CONTENT_RUNTIME__;
					if (!runtime) return { present: false };
					const digests = [];
					const scanErrors = [];
					const seen = new Set();
					let visited = 0;
					const scan = (value, depth) => {
						if (!value || typeof value !== 'object' || depth > 6 || visited > 4000 || seen.has(value)) return;
						visited++;
						seen.add(value);
						if (typeof value.describeMedia === 'function') {
							try { digests.push(value.describeMedia()); }
							catch (error) { scanErrors.push(String(error).slice(0, 120)); }
							return;
						}
						for (const key of Object.keys(value)) {
							try {
								const child = value[key];
								if (child && typeof child === 'object') scan(child, depth + 1);
							} catch (error) { scanErrors.push(String(error).slice(0, 120)); }
						}
					};
					scan(runtime, 0);
					return { present: true, keys: Object.keys(runtime), visited,
						digests: digests.slice(0, 2), scanErrors: scanErrors.slice(0, 3) };
				})(),
				media: [...document.querySelectorAll('video,audio')].map(element => {
					const node = /** @type {HTMLMediaElement} */ (element);
					const stream = node.srcObject;
					const rect = node.getBoundingClientRect();
					const base = {
						id: node.id,
						durationIsNaN: Number.isNaN(node.duration),
						durationIsInfinity: node.duration === Number.POSITIVE_INFINITY,
						bufferedLength: node.buffered?.length ?? null,
						paused: node.paused,
						visibleArea: Math.max(0, rect.width) * Math.max(0, rect.height),
						// The exact shipped predicate, evaluated in the extension's own world.
						isLiveMediaAsShipped: (() => {
							if (node.duration !== Number.POSITIVE_INFINITY) return false;
							if ((node.buffered?.length ?? 0) > 0) return true;
							const attached = node.srcObject;
							return Boolean(attached && typeof attached.getTracks === 'function');
						})(),
					};
					if (!stream) return { ...base, hasStream: false };
					let videoTracks = null; let audioTracks = null;
					try {
						videoTracks = MediaStream.prototype.getVideoTracks.call(stream).length;
						audioTracks = MediaStream.prototype.getAudioTracks.call(stream).length;
					} catch (error) { return { ...base, hasStream: true, error: String(error) }; }
					return {
						...base,
						hasStream: true,
						instanceOfIsolatedMediaStream: stream instanceof MediaStream,
						videoTracks, audioTracks,
						nativeAudioAbsentWouldBe: stream instanceof MediaStream && videoTracks > 0 && audioTracks === 0,
					};
				}),
			}),
		});
		return result?.result ?? null;
	}, tabId);

	out.steps.actualRead = await worker.evaluate(async ({ id, docId }) => {
		const message = {
			protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.actual.read',
			payload: { fields: ['volumeBase', 'mediaMuted', 'boost'], target: null },
			tabId: id, ...(docId ? { documentId: docId } : {}),
		};
		try {
			return await chrome.tabs.sendMessage(id, message, docId ? { documentId: docId } : undefined);
		} catch (error) { return { transportError: String(error) }; }
	}, { id: tabId, docId: documentId });

	const before = await worker.evaluate(async id => {
		const key = `spectra.control.tab.${id}`;
		return ((await chrome.storage.local.get(key))[key])?.activeMedia ?? null;
	}, tabId);
	out.steps.actualReadExplicit = await worker.evaluate(async ({ id, docId, target }) => {
		const message = {
			protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.actual.read',
			payload: { fields: ['volumeBase', 'mediaMuted', 'boost'], target },
			tabId: id, ...(docId ? { documentId: docId } : {}),
		};
		try {
			return await chrome.tabs.sendMessage(id, message, docId ? { documentId: docId } : undefined);
		} catch (error) { return { transportError: String(error) }; }
	}, { id: tabId, docId: documentId, target: before });

	// Only a toolbar action popup carries the trust the control contract requires.
	const known = new Set(browser.targets());
	const pending = browser.waitForTarget(target => !known.has(target)
		&& target.url().startsWith(`chrome-extension://${out.extensionId}/popup.html`), { timeout: 20_000 });
	const session = await browser.target().createCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
		const tab = targetInfos.find(target => target.url === page.url());
		if (!tab) throw new Error('Live tab target is missing');
		await session.send('Extensions.triggerAction', { id: out.extensionId, targetId: tab.targetId });
	} finally { await session.detach(); }
	popup = await (await pending).asPage();

	const readSnapshot = () => worker.evaluate(async id => {
		const key = `spectra.control.tab.${id}`;
		const snapshot = (await chrome.storage.local.get(key))[key];
		return snapshot ? {
			activeMedia: snapshot.activeMedia,
			volumeBase: snapshot.fields?.volumeBase,
			boost: snapshot.fields?.boost,
			mediaMuted: snapshot.fields?.mediaMuted,
			live: snapshot.live,
		} : null;
	}, tabId);

	await popup.evaluate(() => {
		const original = chrome.runtime.sendMessage.bind(chrome.runtime);
		/** @type {any[]} */ (window).__probeMessages = [];
		// @ts-expect-error probe-only wrapper
		chrome.runtime.sendMessage = (...args) => {
			/** @type {any[]} */ (window).__probeMessages.push(args[0]);
			return original(...args);
		};
	});
	const selector = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
	await popup.waitForSelector(selector, { timeout: 20_000 });
	const step = await popup.$eval(selector, element => Number(/** @type {HTMLInputElement} */ (element).step));
	out.steps.slider = { selector, step, requested: VOLUME };
	if (step > 0 && VOLUME % step === 0) {
		await popup.focus(selector);
		await popup.keyboard.press('Home');
		for (let index = 0; index < VOLUME / step; index++) await popup.keyboard.press('ArrowRight');
		out.steps.slider.dispatched = true;
	} else out.steps.slider.dispatched = false;
	await new Promise(resolveTimer => setTimeout(resolveTimer, 2500));
	out.steps.sliderMessages = await popup.evaluate(() => /** @type {any[]} */ (window).__probeMessages
		.filter(message => String(message?.type ?? '').startsWith('spectra.control'))
		.map(message => ({ type: message.type, payload: message.payload })));
	out.steps.snapshotAfterSlider = await readSnapshot();

	out.steps.popupIntent = await popup.evaluate(async ({ id, value }) => chrome.runtime.sendMessage({
		protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: id,
		payload: { tabId: id, source: 'popup', requestedCoverage: 'active-target', target: null, patch: { volumeBase: value } },
	}), { id: tabId, value: VOLUME });
	await new Promise(resolveTimer => setTimeout(resolveTimer, 1500));
	out.steps.snapshotAfterIntent = await readSnapshot();
	out.steps.pageWorldAfter = await page.evaluate(() => [...document.querySelectorAll('video,audio')]
		.map(element => ({ tag: element.tagName, id: element.id,
			volume: /** @type {HTMLMediaElement} */ (element).volume,
			muted: /** @type {HTMLMediaElement} */ (element).muted })));

	if (process.env.SPECTRA_PROBE_TAB_AUDIO === '1') {
		// Sample from the action popup itself. Opening a second extension page
		// would defocus and destroy the popup, and a plain extension page cannot
		// submit a trusted control intent.
		const sample = () => popup.evaluate(async targetTabId => {
			const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
				video: false,
			});
			const context = new AudioContext();
			const analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			context.createMediaStreamSource(stream).connect(analyser);
			analyser.connect(context.destination);
			await context.resume();
			try {
				await new Promise(resolve => setTimeout(resolve, 250));
				const data = new Float32Array(analyser.fftSize);
				let energy = 0; let frames = 0;
				for (let index = 0; index < 20; index++) {
					await new Promise(resolve => setTimeout(resolve, 25));
					analyser.getFloatTimeDomainData(data);
					for (const value of data) energy += value * value;
					frames++;
				}
				return Math.sqrt(energy / (frames * data.length));
			} finally {
				for (const track of stream.getTracks()) track.stop();
				await context.close();
			}
		}, tabId);
		try {
			out.steps.tabAudio = {};
			for (const level of [0, 100]) {
				const response = await popup.evaluate(async ({ id, value }) => chrome.runtime.sendMessage({
					protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: id,
					payload: { tabId: id, source: 'popup', requestedCoverage: 'active-target', target: null,
						patch: { volumeBase: value } },
				}), { id: tabId, value: level });
				await new Promise(resolveTimer => setTimeout(resolveTimer, 1200));
				const presentation = await page.evaluate(() => ({
					elementVolume: [...document.querySelectorAll('video')]
						.map(element => /** @type {HTMLMediaElement} */ (element).volume),
					volumeControls: [...document.querySelectorAll('[title],[aria-label],[class*="volume"],[class*="Volume"],button,[role="slider"]')]
						.filter(node => /音|volume|mute/i.test([
							node.getAttribute('title'), node.getAttribute('aria-label'), String(node.className),
						].join(' ')))
						.slice(0, 12)
						.map(node => ({
							tag: node.tagName, className: String(node.className).slice(0, 80),
							title: node.getAttribute('title'), aria: node.getAttribute('aria-label'),
							ariaValueNow: node.getAttribute('aria-valuenow'),
							text: (node.textContent ?? '').trim().slice(0, 30),
							value: /** @type {any} */ (node).value ?? null,
						})),
				}));
				let rms = null;
				try { rms = await sample(); } catch (error) { rms = { error: String(error).slice(0, 300) }; }
				out.steps.tabAudio[String(level)] = {
					controlOk: response?.ok === true,
					elementVolume: presentation.elementVolume,
					volumeControls: presentation.volumeControls,
					tabRms: rms,
				};
			}
		} catch (error) { out.errors.push(`tabAudio: ${String(error).slice(0, 400)}`); }
	}
} catch (error) {
	out.errors.push(String(error?.stack ?? error).slice(0, 1200));
} finally {
	await popup?.close().catch(() => undefined);
	await page?.close().catch(() => undefined);
	await browser.close().catch(() => undefined);
}

console.log(JSON.stringify(out, null, 2));
