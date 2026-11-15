// goal: verify that the local signed-in Douyin state can be reused by the Chrome 157 real-site harness
// inv: read-only diagnosis; copies cookie names into a throwaway profile, never prints cookie values
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-authed.mjs
// output: JSON on stdout; [E-anecdotal] unless the gated smoke case confirms the extension behaviour
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SOURCE_USER_DATA = process.env.SPECTRA_AUTHED_SOURCE_PROFILE?.trim()
	|| join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const PORTAL = process.env.SPECTRA_DOUYIN_PORTAL_URL?.trim() || 'https://www.douyin.com/';
const LIVE = process.env.SPECTRA_DOUYIN_LIVE_URL?.trim() || 'https://live.douyin.com/';
const HEADLESS = process.env.SPECTRA_PROBE_HEADED !== '1';

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-signed-in-state-diagnostic',
	chrome: CHROME,
	sourceProfile: SOURCE_USER_DATA,
	portal: PORTAL,
	live: LIVE,
	viewport: { width: 1600, height: 1200 },
	headless: HEADLESS,
	method: 'copy Local State and Default/Network/Cookies into a throwaway profile; load public pages in real Chrome',
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-douyin-authed-'));
let browser;
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
			// A missing optional file is recorded; only the cookie DB is required.
			copied.push(`${relative}: missing (${String(error).slice(0, 60)})`);
		}
	}
	const localState = JSON.parse(await readFile(join(profile, 'Local State'), 'utf8'));
	out.steps.profilePrepared = {
		profileDir: profile,
		copied,
		hasOsCryptKey: typeof localState?.os_crypt?.encrypted_key === 'string',
		hasAppBoundKey: typeof localState?.os_crypt?.app_bound_encrypted_key === 'string',
	};

	browser = await puppeteer.launch({
		executablePath: CHROME,
		headless: HEADLESS,
		protocolTimeout: 120_000,
		ignoreDefaultArgs: ['--mute-audio'],
		userDataDir: profile,
		args: ['--no-sandbox', '--disable-setuid-sandbox',
			'--autoplay-policy=no-user-gesture-required',
			'--disable-blink-features=AutomationControlled',
			'--force-device-scale-factor=1', '--window-size=1600,1200'],
	});
	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });

	// Only names are reported; encrypted values never leave the throwaway
	// profile. Browser-level enumeration can be unsupported on some Chrome
	// builds, so the page-scoped read after navigation is the real oracle.
	const browserSession = await browser.target().createCDPSession();
	const { cookies } = await browserSession.send('Storage.getCookies')
		.catch(error => {
			out.errors.push(`browser cookies: ${String(error).slice(0, 160)}`);
			return { cookies: [] };
		});
	const douyinNames = cookies
		.filter(cookie => /douyin\.com$/.test(cookie.domain))
		.map(cookie => cookie.name).sort();
	out.steps.cookieNames = douyinNames;
	out.steps.hasSessionCookie = douyinNames.includes('sessionid');
	await browserSession.detach();

	const readPage = () => page.evaluate(() => ({
		href: location.href,
		title: document.title,
		captchaIframes: [...document.querySelectorAll('iframe')]
			.map(frame => frame.src).filter(src => /verify|captcha|secsdk/i.test(src)).slice(0, 5),
		mediaCount: document.querySelectorAll('video,audio').length,
		media: [...document.querySelectorAll('video')].slice(0, 6).map(node => {
			const element = /** @type {HTMLVideoElement} */ (node);
			const box = element.getBoundingClientRect();
			const stream = element.srcObject;
			return {
				id: element.id, volume: element.volume, paused: element.paused,
				streamTracks: stream && typeof stream.getVideoTracks === 'function'
					? { video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length }
					: null,
				box: { w: Math.round(box.width), h: Math.round(box.height) },
			};
		}),
		loginPrompt: /登录|立即登录|扫码登录/.test(document.body?.textContent?.slice(0, 1500) ?? ''),
		textSample: (document.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 180),
		liveLinks: [...document.querySelectorAll('a[href]')]
			.map(node => /** @type {HTMLAnchorElement} */ (node).href)
			.filter(href => /live\.douyin\.com/u.test(href)).slice(0, 6),
	}));

	await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(6000);
	out.steps.portal = await readPage();
	const portalSession = await page.createCDPSession();
	const portalCookies = await portalSession.send('Network.getCookies', { urls: [PORTAL] })
		.catch(error => {
			out.errors.push(`portal cookies: ${String(error).slice(0, 160)}`);
			return { cookies: [] };
		});
	out.steps.portalCookieNames = portalCookies.cookies.map(cookie => cookie.name).sort();
	await portalSession.detach();

	// A whole-document cross-origin navigation is the previously unproven path.
	await page.goto(out.steps.portal.liveLinks[0] || LIVE,
		{ waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(8000);
	out.steps.crossOriginNavigation = await readPage();
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
