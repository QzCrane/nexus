// goal: diagnose why the signed-in www.douyin.com/follow feed stays empty in a throwaway profile copy
// inv: real Chrome 157, FULL profile copy, production dist via CDP Extensions.loadUnpacked,
//      read-only DOM/network/login-state inspection; no writes to extension state
// usage: bun scripts/probe-douyin-follow-recon.mjs
// output: JSON on stdout
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SOURCE_USER_DATA = process.env.SPECTRA_AUTHED_SOURCE_PROFILE?.trim()
	|| join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const FOLLOW = 'https://www.douyin.com/follow';
const HEADLESS = process.env.SPECTRA_PROBE_HEADED === '0';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-follow-feed-render-diagnosis',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	follow: FOLLOW,
	method: 'full signed-in profile copy + production dist via CDP Extensions.loadUnpacked; read-only DOM, network and login-state inspection',
	steps: {},
	errors: [],
};
const profile = await mkdtemp(join(tmpdir(), 'spectra-follow-recon-'));
let browser;
let page;

try {
	await mkdir(join(profile, 'Default'), { recursive: true });
	const copied = [];
	for (const relative of ['Local State', 'Default/Preferences', 'Default/Secure Preferences',
		'Default/Network', 'Default/Local Storage', 'Default/Session Storage',
		'Default/IndexedDB', 'Default/WebStorage']) {
		const source = join(SOURCE_USER_DATA, ...relative.split('/'));
		const target = join(profile, ...relative.split('/'));
		try {
			await stat(source);
			await mkdir(join(target, '..'), { recursive: true });
			await cp(source, target, { recursive: true, force: true });
			copied.push(relative);
		} catch (error) {
			copied.push(`${relative}: missing (${String(error).slice(0, 80)})`);
		}
	}
	out.steps.profileCopied = copied;

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
	const cookieSession = await browser.target().createCDPSession();
	const { cookies } = await cookieSession.send('Storage.getCookies');
	await cookieSession.detach();
	const douyinCookies = cookies.filter(cookie =>
		/douyin\.com$/u.test(cookie.domain.replace(/^\./u, '')));
	out.steps.cookieState = {
		total: cookies.length,
		douyin: douyinCookies.length,
		loginNames: douyinCookies
			.filter(cookie => /sessionid|sid_tt|sid_guard|uid_tt/iu.test(cookie.name))
			.map(cookie => ({ name: cookie.name, httpOnly: cookie.httpOnly,
				expires: cookie.expires, hasValue: !!cookie.value })),
	};
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(error => out.errors.push(`detach: ${String(error).slice(0, 120)}`));

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	const apiResponses = [];
	const failedRequests = [];
	const consoleErrors = [];
	page.on('response', response => {
		if (apiResponses.length >= 80) return;
		const url = response.url();
		if (/douyin\.com\/aweme|follow\/feed|\/live\//iu.test(url)) {
			apiResponses.push({ status: response.status(), url: url.slice(0, 170),
				resourceType: response.request().resourceType() });
		}
	});
	page.on('requestfailed', request => {
		if (failedRequests.length < 20) {
			failedRequests.push({ url: request.url().slice(0, 160),
				reason: request.failure()?.errorText ?? null });
		}
	});
	page.on('console', message => {
		if (message.type() === 'error' && consoleErrors.length < 20) {
			consoleErrors.push(message.text().slice(0, 180));
		}
	});

	const snapshot = () => page.evaluate(() => {
		const cookieNames = document.cookie.split(';')
			.map(part => part.trim().split('=')[0]).filter(Boolean);
		let storageKeys = [];
		try { storageKeys = Object.keys(localStorage).slice(0, 30); }
		catch (error) { storageKeys = [`blocked: ${String(error).slice(0, 60)}`]; }
		const liveNodes = [...document.querySelectorAll('*')]
			.filter(node => node.childElementCount === 0 && /直播|LIVE/iu.test((node.textContent ?? '').trim()))
			.slice(0, 24).map(node => ({ text: (node.textContent ?? '').trim().slice(0, 36),
				cls: String(node.className ?? '').slice(0, 70) }));
		return {
			href: location.href,
			title: document.title,
			cookieCount: cookieNames.length,
			cookieNames: cookieNames.slice(0, 30),
			storageKeys,
			loginPrompt: /登录注册|登录后|立即登录|扫码登录/u.test(document.body?.textContent ?? ''),
			bodySample: (document.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 600),
			bodyLength: (document.body?.textContent ?? '').length,
			mediaCount: document.querySelectorAll('video,audio').length,
			links: [...document.querySelectorAll('a[href]')].slice(0, 50).map(a => ({
				href: a.getAttribute('href')?.slice(0, 110) ?? null,
				text: (a.textContent ?? '').trim().slice(0, 36),
			})),
			liveNodes,
			visibleText: (() => {
				const clone = document.body?.cloneNode(true);
				clone?.querySelectorAll('script,style,noscript,template').forEach(node => { node.remove(); });
				return (clone?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 1600);
			})(),
			liveEntries: [...document.querySelectorAll('a[href*="live"], [class*="live"], [class*="Live"]')]
				.slice(0, 30).map(node => {
					const rect = node.getBoundingClientRect();
					return { tag: node.tagName, cls: String(node.className ?? '').slice(0, 70),
						href: node.getAttribute('href'),
						text: (node.textContent ?? '').trim().slice(0, 40),
						box: { x: Math.round(rect.x), y: Math.round(rect.y),
							w: Math.round(rect.width), h: Math.round(rect.height) } };
				}),
			liveClassNodes: [...document.querySelectorAll('[class*="live"], [class*="Live"]')]
				.slice(0, 20).map(node => ({ tag: node.tagName,
					cls: String(node.className ?? '').slice(0, 80),
					text: (node.textContent ?? '').trim().slice(0, 30) })),
		};
	});

	await page.goto(FOLLOW, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(10_000);
	out.steps.initial = await snapshot();
	await page.evaluate(() => window.scrollTo(0, 700));
	await wait(4000);
	out.steps.afterScroll = await snapshot();
	if (process.env.SPECTRA_FOLLOW_RECON_CLICK === '1') {
		const clickTarget = await page.evaluate(() => {
			const tab = document.querySelector('.tab-live');
			const rect = tab?.getBoundingClientRect();
			return rect && rect.width > 8 && rect.height > 8
				? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2),
					box: { w: Math.round(rect.width), h: Math.round(rect.height) },
					text: (tab.textContent ?? '').trim().slice(0, 30) }
				: null;
		});
		out.steps.clickTarget = clickTarget;
		if (clickTarget) {
			await page.mouse.click(clickTarget.x, clickTarget.y);
			await wait(9000);
			out.steps.afterClick = await snapshot();
			out.steps.afterClickPlayer = await page.evaluate(() => {
				const track = document.querySelector('.douyin-player-volume-slider-track')
					?.getBoundingClientRect();
				return {
					href: location.href,
					volumeNumber: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
					volumeTrack: track ? { w: Math.round(track.width), h: Math.round(track.height) } : null,
					playerNodes: [...document.querySelectorAll('[class*="douyin-player"]')].slice(0, 12)
						.map(node => ({ cls: String(node.className ?? '').slice(0, 90),
							text: (node.textContent ?? '').trim().slice(0, 30) })),
					media: [...document.querySelectorAll('video,audio')].slice(0, 6).map(node => ({
						volume: Number(node.volume.toFixed(3)), muted: node.muted, paused: node.paused,
					})),
				};
			});
		}
	}
	out.steps.network = { apiResponses, failedRequests, consoleErrors };
	out.verdict = {
		loggedInCookies: out.steps.initial.cookieNames.filter(name => /sessionid|sid_tt|uid_tt|passport|odin_tt/iu.test(name)),
		feedRendered: out.steps.initial.bodyLength > 1200
			|| out.steps.afterScroll.bodyLength > 1200,
		liveCardCount: out.steps.initial.liveNodes.length + out.steps.afterScroll.liveNodes.length,
		note: 'Diagnosis only. This probe never drives the native volume slider and is not badge evidence.',
	};
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 120)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 120)}`));
}

console.log(JSON.stringify(out, null, 2));
