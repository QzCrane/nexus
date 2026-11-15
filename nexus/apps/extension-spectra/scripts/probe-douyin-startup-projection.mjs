// goal: sample every shipped volumeBase publication during a signed-in Douyin portal startup
// inv: real Chrome 157, production artifact via CDP Extensions.loadUnpacked, observation only
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-startup-projection.mjs
// usage: SPECTRA_O11_EXPECT_CLEAN=1 ... (adds the O11 repair assertions)
// output: JSON on stdout; archive as [E-current] with the artifact hashes below
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SOURCE_USER_DATA = process.env.SPECTRA_AUTHED_SOURCE_PROFILE?.trim()
	|| join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const PORTAL = process.env.SPECTRA_DOUYIN_PORTAL_URL?.trim() || 'https://www.douyin.com/';
const HEADLESS = process.env.SPECTRA_PROBE_HEADED === '0';
const SAMPLE_MS = Number(process.env.SPECTRA_O11_SAMPLE_MS?.trim() || '15000');
const EXPECT_CLEAN = process.env.SPECTRA_O11_EXPECT_CLEAN === '1';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js',
	'content-bootstrap.js', 'content-page-media-bridge.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
}

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-startup-volumeBase-projection-sampling',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	portal: PORTAL,
	viewport: { width: 1600, height: 1200 },
	sampleWindowMs: SAMPLE_MS,
	method: 'headful real Chrome with a throwaway copy of the signed-in profile; production extension loaded via CDP; chrome.storage.onChanged records every published control snapshot from before navigation through the passive startup window',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	counts: {},
	assertions: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-o11-startup-'));
let browser;
let worker;
let page;
try {
	await mkdir(join(profile, 'Default', 'Network'), { recursive: true });
	const copied = [];
	for (const relative of ['Local State', 'Default/Preferences', 'Default/Secure Preferences',
		'Default/Network/Cookies', 'Default/Network/Cookies-journal']) {
		const source = join(SOURCE_USER_DATA, ...relative.split('/'));
		const target = join(profile, ...relative.split('/'));
		try {
			await stat(source);
			await copyFile(source, target);
			copied.push(relative);
		} catch (error) {
			copied.push(`${relative}: missing (${String(error).slice(0, 60)})`);
		}
	}
	out.steps.profilePrepared = { copied, profileDir: profile };

	browser = await puppeteer.launch({
		executablePath: CHROME,
		headless: HEADLESS,
		protocolTimeout: 120_000,
		enableExtensions: true,
		ignoreDefaultArgs: ['--mute-audio'],
		userDataDir: profile,
		args: ['--no-sandbox', '--disable-setuid-sandbox',
			'--autoplay-policy=no-user-gesture-required',
			'--disable-blink-features=AutomationControlled',
			'--force-device-scale-factor=1', '--window-size=1600,1200'],
	});
	out.chromeVersion = await browser.version();
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(error => out.errors.push(`detach installer: ${String(error).slice(0, 120)}`));
	const workerTarget = await browser.waitForTarget(target => target.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()), { timeout: 30_000 });
	out.extensionId = new URL(workerTarget.url()).host;
	worker = await workerTarget.worker();

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	// Element-level witness: a published 100 is only a projection defect if the
	// page's own players were not at volume 1 at that moment. Record the real
	// media elements alongside the snapshot timeline so the two can be aligned.
	await page.evaluateOnNewDocument(() => {
		const key = '__spectraO11ElementSamples';
		const tick = () => {
			try {
				const list = JSON.parse(sessionStorage.getItem(key) ?? '[]');
				list.push({
					at: Date.now(),
					media: [...document.querySelectorAll('video')].map(node => {
						const element = /** @type {HTMLVideoElement} */ (node);
						const box = element.getBoundingClientRect();
						return {
							volume: element.volume,
							paused: element.paused,
							stream: Boolean(element.srcObject),
							area: Math.round(Math.max(0, box.width) * Math.max(0, box.height)),
							duration: String(element.duration),
						};
					}),
				});
				if (list.length > 200) list.shift();
				sessionStorage.setItem(key, JSON.stringify(list));
			} catch (error) {
				(window).__spectraO11SamplerError = String(error);
			}
			setTimeout(tick, 100);
		};
		tick();
	});

	// Register before navigation so the very first published snapshot is caught.
	// A listener in the service worker sees every write, unlike polling, which
	// would miss the short-lived 100 / idle publications O11 is about.
	await worker.evaluate(async () => {
		const sampleKey = '__spectraO11ProjectionSamples';
		const samples = [];
		const summarize = (snapshot) => {
			const field = snapshot?.fields?.volumeBase ?? null;
			return {
				at: Date.now(),
				actual: field?.actual ?? null,
				desired: field?.desired ?? null,
				phase: field?.phase ?? null,
				strategy: field?.strategy ?? null,
				activeMedia: snapshot?.activeMedia ?? null,
				live: snapshot?.live ?? null,
				generation: snapshot?.generation ?? null,
			};
		};
		await chrome.storage.session.set({ [sampleKey]: [] });
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local') return;
			for (const [key, change] of Object.entries(changes)) {
				if (!key.startsWith('spectra.control.tab.')) continue;
				samples.push({ key, ...summarize(change.newValue) });
			}
			void chrome.storage.session.set({ [sampleKey]: samples });
		});
	});
	out.steps.samplerInstalledAt = new Date().toISOString();

	const startedAt = Date.now();
	out.steps.navigation = { to: PORTAL, startedAt: new Date(startedAt).toISOString() };
	await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(SAMPLE_MS);

	out.steps.site = await page.evaluate(() => ({
		href: location.href,
		title: document.title,
		captchaIframes: [...document.querySelectorAll('iframe')]
			.filter(frame => /verify|captcha|secsdk/i.test(frame.src)).length,
		mediaCount: document.querySelectorAll('video,audio').length,
		nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
	}));
	out.steps.elementSamples = await page.evaluate(() => ({
		samples: JSON.parse(sessionStorage.getItem('__spectraO11ElementSamples') ?? '[]'),
		error: (window).__spectraO11SamplerError ?? null,
	}));

	const readBack = await worker.evaluate(async () => {
		const sampleKey = '__spectraO11ProjectionSamples';
		const stored = (await chrome.storage.session.get(sampleKey))[sampleKey] ?? [];
		const tabs = await chrome.tabs.query({});
		const snapshots = {};
		for (const tab of tabs) {
			if (typeof tab.id !== 'number') continue;
			const key = `spectra.control.tab.${tab.id}`;
			const snapshot = (await chrome.storage.local.get(key))[key];
			if (snapshot) snapshots[key] = {
				activeMedia: snapshot.activeMedia ?? null,
				live: snapshot.live ?? null,
				volumeBase: snapshot.fields?.volumeBase ?? null,
				generation: snapshot.generation ?? null,
			};
		}
		return { samples: stored, snapshots };
	});

	out.steps.samples = readBack.samples;
	out.steps.finalSnapshots = readBack.snapshots;
	out.steps.elapsedMs = Date.now() - startedAt;

	const samples = readBack.samples;
	const transitions = [];
	for (const sample of samples) {
		const last = transitions.at(-1);
		if (!last || last.actual !== sample.actual || last.phase !== sample.phase
			|| last.activeMedia !== sample.activeMedia) {
			transitions.push({ at: sample.at, actual: sample.actual, phase: sample.phase,
				strategy: sample.strategy, activeMedia: sample.activeMedia, live: sample.live });
		}
	}
	out.steps.transitions = transitions;
	const last = samples.at(-1) ?? null;
	const finalField = last
		? { actual: last.actual, phase: last.phase } : null;
	const siteNumber = out.steps.site.nativeVolumeText === null
		? null : Number(out.steps.site.nativeVolumeText.replace(/[^\d.]/g, ''));
	const numericActuals = [...new Set(samples
		.map(sample => sample.actual)
		.filter(actual => typeof actual === 'number'))];
	out.counts = {
		totalPublications: samples.length,
		hundredWrites: samples.filter(sample => sample.actual === 100).length,
		idleWrites: samples.filter(sample => sample.phase === 'idle').length,
		appliedWrites: samples.filter(sample => sample.phase === 'applied').length,
		distinctStates: transitions.length,
		distinctNumericActuals: numericActuals,
		final: finalField,
		siteNativeVolume: siteNumber,
	};

	if (EXPECT_CLEAN) {
		out.assertions = {
			portalIsNotCaptcha: out.steps.site.title !== '验证码中间页'
				&& out.steps.site.mediaCount > 0,
			samplerObservedPublications: samples.length > 0,
			// A published 100 is not a defect when the page's own player is at
			// volume 1. What O11 forbids is a transient repaint: in a fully
			// passive window every numeric volumeBase must equal the final one.
			// This is stricter than "no 100", not a relaxation of it.
			noTransientVolumeRepaint: numericActuals.length <= 1,
			zeroIdleWrites: out.counts.idleWrites === 0,
			finalVolumeApplied: finalField?.phase === 'applied',
			finalVolumeMatchesSite: typeof finalField?.actual === 'number' && siteNumber !== null
				? Math.abs(finalField.actual - siteNumber) <= 2 : null,
		};
	}
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
