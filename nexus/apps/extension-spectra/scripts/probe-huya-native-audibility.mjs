// goal: decide whether Huya's own volume bar owns the audible signal and whether
// the extension's isolated world can drive that bar with a synthetic input
// inv: observation only; no product source is modified
// usage: SPECTRA_PROBE_LIVE_URL=https://www.huya.com/102411 bun scripts/probe-huya-native-audibility.mjs
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LIVE_URL = process.env.SPECTRA_PROBE_LIVE_URL?.trim() || 'https://www.huya.com/102411';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const WAIT_MS = Number(process.env.SPECTRA_PROBE_WAIT_MS ?? 30_000);
const OUT = process.env.SPECTRA_PROBE_OUT?.trim();

const hashes = {};
for (const file of ['manifest.json', 'background.js', 'content-runtime.js', 'popup.js']) {
	hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
}
const profile = await mkdtemp(join(tmpdir(), 'spectra-huya-aud-'));
const browser = await puppeteer.launch({
	executablePath: CHROME, headless: true, enableExtensions: true,
	ignoreDefaultArgs: ['--mute-audio'], userDataDir: profile,
	args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1', '--window-size=1600,1200'],
});
let worker;
let page;
let popup;
const out = { capturedAt: new Date().toISOString(), liveUrl: LIVE_URL,
	chrome: CHROME, chromeVersion: null, dist: hashes, samples: {}, steps: {}, errors: [] };

const readSite = () => page.evaluate(() => {
	const bar = document.querySelector('.sound-bar');
	const video = document.querySelector('#hy-video');
	return { barWidth: bar?.getBoundingClientRect().width ?? null,
		barStyle: bar?.getAttribute('style') ?? null,
		elementVolume: /** @type {HTMLMediaElement} */ (video)?.volume ?? null };
});

const syntheticVolume = (ratio, world) => {
	const source = (targetRatio) => {
		const progress = document.querySelector('.sound-progress');
		if (!progress) return false;
		const rect = progress.getBoundingClientRect();
		const x = rect.left + rect.width * targetRatio;
		const y = rect.top + rect.height / 2;
		const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
		for (const type of ['pointerdown', 'mousedown']) {
			progress.dispatchEvent(new MouseEvent(type, { ...base, buttons: 1 }));
		}
		progress.dispatchEvent(new MouseEvent('pointermove', { ...base, buttons: 1 }));
		document.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 1 }));
		for (const type of ['pointerup', 'mouseup', 'click']) {
			progress.dispatchEvent(new MouseEvent(type, { ...base, buttons: 0 }));
		}
		return true;
	};
	if (world === 'page') return page.evaluate(source, ratio);
	return worker.evaluate(async ({ id, targetRatio }) => {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: id, frameIds: [0] }, world: 'ISOLATED',
			func: (eachRatio) => {
				const progress = document.querySelector('.sound-progress');
				if (!progress) return false;
				const rect = progress.getBoundingClientRect();
				const x = rect.left + rect.width * eachRatio;
				const y = rect.top + rect.height / 2;
				const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
				for (const type of ['pointerdown', 'mousedown']) {
					progress.dispatchEvent(new MouseEvent(type, { ...base, buttons: 1 }));
				}
				progress.dispatchEvent(new MouseEvent('pointermove', { ...base, buttons: 1 }));
				document.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 1 }));
				for (const type of ['pointerup', 'mouseup', 'click']) {
					progress.dispatchEvent(new MouseEvent(type, { ...base, buttons: 0 }));
				}
				return true;
			},
			args: [targetRatio],
		});
		return result?.result ?? null;
	}, { id: out.tabId, targetRatio: ratio });
};

const sampleRms = () => popup.evaluate(async targetTabId => {
	const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
	});
	const context = new AudioContext();
	const analyser = context.createAnalyser();
	analyser.fftSize = 2048;
	context.createMediaStreamSource(stream).connect(analyser);
	analyser.connect(context.destination);
	await context.resume();
	try {
		const data = new Float32Array(analyser.fftSize);
		let energy = 0;
		let frames = 0;
		for (let index = 0; index < 24; index++) {
			await new Promise(resolve => setTimeout(resolve, 25));
			analyser.getFloatTimeDomainData(data);
			for (const value of data) energy += value * value;
			frames += 1;
		}
		return Math.sqrt(energy / (frames * data.length));
	} finally {
		for (const track of stream.getTracks()) track.stop();
		await context.close();
	}
}, out.tabId);

const openPopup = async () => {
	const known = new Set(browser.targets());
	const pending = browser.waitForTarget(target => !known.has(target)
		&& target.url().startsWith(`chrome-extension://${out.extensionId}/popup.html`), { timeout: 20_000 });
	const session = await browser.target().createCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets',
			{ filter: [{ type: 'tab', exclude: false }] });
		const tab = targetInfos.find(target => target.url === page.url());
		if (!tab) throw new Error('Live tab target is missing');
		await session.send('Extensions.triggerAction', { id: out.extensionId, targetId: tab.targetId });
	} finally { await session.detach(); }
	return (await pending).asPage();
};

try {
	out.chromeVersion = await browser.version();
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(() => undefined);
	const target = await browser.waitForTarget(candidate => candidate.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(candidate.url()), { timeout: 30_000 });
	out.extensionId = new URL(target.url()).host;
	worker = await target.worker();
	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await new Promise(resolve => setTimeout(resolve, WAIT_MS));
	const tab = (await worker.evaluate(async url => {
		const found = (await chrome.tabs.query({})).find(candidate => candidate.url === url);
		if (!found?.id) throw new Error('Live tab not found');
		return found.id;
	}, page.url()));
	out.tabId = tab;
	await page.evaluate(() => window.scrollTo(0, 420));
	await new Promise(resolve => setTimeout(resolve, 600));
	await (await page.$('#player-sound-btn'))?.hover();
	await new Promise(resolve => setTimeout(resolve, 500));
	out.steps.baselineSite = await readSite();

	popup = await openPopup();
	try { out.samples.baseline = await sampleRms(); }
	catch (error) { out.samples.baseline = { error: String(error).slice(0, 300) }; }
	await popup.close(); popup = null;

	// The product code runs in ISOLATED; verify that world can drive the control.
	out.steps.isolatedDispatch = await syntheticVolume(0.1, 'isolated');
	await new Promise(resolve => setTimeout(resolve, 1500));
	out.steps.afterIsolatedLow = await readSite();
	popup = await openPopup();
	try { out.samples.siteVolumeLow = await sampleRms(); }
	catch (error) { out.samples.siteVolumeLow = { error: String(error).slice(0, 300) }; }
	await popup.close(); popup = null;

	await syntheticVolume(0.9, 'page');
	await new Promise(resolve => setTimeout(resolve, 1500));
	out.steps.afterPageHigh = await readSite();
	popup = await openPopup();
	try { out.samples.siteVolumeHigh = await sampleRms(); }
	catch (error) { out.samples.siteVolumeHigh = { error: String(error).slice(0, 300) }; }
	await popup.close(); popup = null;

	if (process.env.SPECTRA_PROBE_PLUGIN_INTENT === '1') {
		popup = await openPopup();
		/** @type {Record<string, unknown>} */ const results = {};
		for (const value of [30, 100]) {
			const ack = await popup.evaluate(async ({ id, requested }) => chrome.runtime.sendMessage({
				protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit',
				tabId: id, payload: { tabId: id, source: 'popup', requestedCoverage: 'active-target',
					target: null, patch: { volumeBase: requested } },
			}), { id: out.tabId, requested: value });
			await new Promise(resolve => setTimeout(resolve, 1700));
			const snapshot = await worker.evaluate(async id => {
				const key = `spectra.control.tab.${id}`;
				const stored = (await chrome.storage.local.get(key))[key];
				return stored?.fields?.volumeBase ?? null;
			}, out.tabId);
			results[String(value)] = { ack: { ok: ack?.ok ?? null,
				volumeBase: ack?.data?.fields?.volumeBase ?? null,
				error: ack?.error ?? null },
			snapshot, site: await readSite(),
			rms: await sampleRms().catch(error => ({ error: String(error).slice(0, 300) })) };
		}
		out.steps.pluginIntent = results;
		await popup.close(); popup = null;
	}
} catch (error) {
	out.errors.push(String(error?.stack ?? error).slice(0, 1400));
} finally {
	await popup?.close().catch(() => undefined);
	await page?.close().catch(() => undefined);
	await browser.close().catch(() => undefined);
}
const json = JSON.stringify(out, null, 2);
if (OUT) await writeFile(OUT, json, 'utf8');
console.log(json);
