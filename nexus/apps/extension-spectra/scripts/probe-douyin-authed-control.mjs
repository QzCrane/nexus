// goal: prove the shipped extension takes over after a whole-document cross-origin navigation into Douyin live
// inv: real Chrome 157, production artifact via CDP Extensions.loadUnpacked, signed-in profile copy, observation only
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-authed-control.mjs
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
const LIVE = process.env.SPECTRA_DOUYIN_LIVE_URL?.trim() || 'https://live.douyin.com/';
const HEADLESS = process.env.SPECTRA_PROBE_HEADED === '0';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js',
	'content-bootstrap.js', 'content-page-media-bridge.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
}

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-cross-origin-navigation-real-site-proof',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	portal: PORTAL,
	live: LIVE,
	viewport: { width: 1600, height: 1200 },
	method: 'headful real Chrome with a throwaway copy of the signed-in profile; production extension loaded via CDP; nine-second passive window after a whole-document cross-origin navigation',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	assertions: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-douyin-control-'));
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

	const readSite = () => page.evaluate(() => ({
		href: location.href,
		title: document.title,
		captchaIframes: [...document.querySelectorAll('iframe')]
			.filter(frame => /verify|captcha|secsdk/i.test(frame.src)).length,
		mediaCount: document.querySelectorAll('video,audio').length,
		nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
		main: [...document.querySelectorAll('video')].map(node => {
			const element = /** @type {HTMLVideoElement} */ (node);
			const box = element.getBoundingClientRect();
			const stream = element.srcObject;
			return { id: element.id, volume: element.volume, paused: element.paused,
				tracks: stream && typeof stream.getVideoTracks === 'function'
					? { video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length }
					: null,
				box: { w: Math.round(box.width), h: Math.round(box.height) },
				duration: String(element.duration) };
		}).slice(0, 8),
		liveLinks: [...document.querySelectorAll('a[href]')]
			.map(node => /** @type {HTMLAnchorElement} */ (node).href)
			.filter(href => /live\.douyin\.com/u.test(href)).slice(0, 4),
	}));

	await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(6000);
	out.steps.portal = await readSite();

	const identity = await worker.evaluate(async url => {
		const tab = (await chrome.tabs.query({})).find(candidate => candidate.url === url);
		if (!tab?.id) throw new Error('Portal tab not found');
		return { tabId: tab.id };
	}, page.url());
	out.steps.identity = identity;
	const { tabId } = identity;

	const readSnapshot = () => worker.evaluate(async id => {
		const key = `spectra.control.tab.${id}`;
		const snapshot = (await chrome.storage.local.get(key))[key];
		if (!snapshot) return null;
		const fields = {};
		for (const [field, value] of Object.entries(snapshot.fields ?? {})) {
			fields[field] = { actual: value?.actual ?? null, desired: value?.desired ?? null,
				phase: value?.phase ?? null, strategy: value?.strategy ?? null,
				lastError: value?.lastError ?? null };
		}
		return { documentId: snapshot.documentId, generation: snapshot.generation,
			activeMedia: snapshot.activeMedia ?? null, live: snapshot.live ?? null, fields };
	}, tabId);
	const readBadge = () => worker.evaluate(async id => ({
		text: await chrome.action.getBadgeText({ tabId: id }),
	}), tabId);

	// Whole-document navigation across origins. No popup, hotkey, snapshot write
	// or control intent is issued during the passive window that follows.
	const destination = out.steps.portal.liveLinks[0] || LIVE;
	out.steps.navigation = { from: page.url(), to: destination };
	await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(9000);
	out.steps.afterPassiveWindow = {
		site: await readSite(),
		snapshot: await readSnapshot(),
		badge: await readBadge(),
	};

	const site = out.steps.afterPassiveWindow.site;
	const snapshot = out.steps.afterPassiveWindow.snapshot;
	const volume = snapshot?.fields?.volumeBase;
	const siteNumber = site.nativeVolumeText === null ? null : Number(site.nativeVolumeText.replace(/[^\d.]/g, ''));
	out.assertions = {
		// A non-blocking risk-control iframe survives even when the portal loads
		// normally. The oracle is the real page title plus real media, not the
		// mere presence of an iframe; the raw count is still recorded below.
		portalIsNotCaptcha: out.steps.portal.title !== '验证码中间页'
			&& out.steps.portal.mediaCount > 0,
		navigationIsCrossOrigin: new URL(destination).origin !== new URL(PORTAL).origin,
		liveHasMedia: site.mediaCount > 0 && site.captchaIframes === 0,
		activeMediaPresent: !!snapshot?.activeMedia,
		volumeBaseApplied: volume?.phase === 'applied' && typeof volume.actual === 'number',
		volumeMatchesSite: typeof volume?.actual === 'number' && siteNumber !== null
			? Math.abs(volume.actual - siteNumber) <= 2 : null,
		// I10: badge visibility is created only by a confirmed user gesture.
		// This window is deliberately passive, so an empty badge is the passing
		// outcome; demanding a numeric badge here would test the contract backwards.
		badgeAbsentWithoutGesture: out.steps.afterPassiveWindow.badge.text === '',
		observed: {
			portalTitle: out.steps.portal.title,
			portalMediaCount: out.steps.portal.mediaCount,
			portalCaptchaIframes: out.steps.portal.captchaIframes,
			liveTitle: site.title,
			liveMediaCount: site.mediaCount,
			siteNativeVolumeText: site.nativeVolumeText,
			volumeBaseActual: volume?.actual ?? null,
			volumeBasePhase: volume?.phase ?? null,
			badgeText: out.steps.afterPassiveWindow.badge.text,
			activeMedia: snapshot?.activeMedia ?? null,
		},
	};
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
