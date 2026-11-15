// goal: A/B control -- repeat the exact /follow live-card click WITHOUT the SPECTRA
//       extension, to tell whether the extra live tab is opened by the site or by us.
// inv: real Chrome 157, same signed-in cookies as the main probe (WorkBuddy built-in
//      browser clear-value store read via the already captured VSS snapshot), NO
//      Extensions.loadUnpacked, real trusted mouse click, read-only target census.
// usage: bun scripts/probe-douyin-follow-newtab-control.mjs
// output: JSON on stdout
import { Database } from 'bun:sqlite';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SNAPSHOT = process.env.SPECTRA_WB_VSS_SNAPSHOT?.trim()
	|| join(tmpdir(), 'spectra-wb-cookies', 'esentutl.db');
const FOLLOW = 'https://www.douyin.com/follow';
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const database = new Database(SNAPSHOT, { readonly: true });
const rows = database.query('select host_key,name,value,path,expires_utc,is_secure,is_httponly,samesite '
	+ "from cookies where host_key like '%douyin.com' and length(value) > 0").all();
database.close();
const cookies = rows.map(row => ({
	name: row.name,
	value: row.value,
	domain: row.host_key,
	path: row.path || '/',
	...(row.expires_utc > 0 ? { expires: row.expires_utc / 1_000_000 - 11_644_473_600 } : {}),
	httpOnly: row.is_httponly === 1,
	secure: row.is_secure === 1,
	...(row.samesite === 0 ? { sameSite: 'None' }
		: row.samesite === 1 ? { sameSite: 'Lax' }
			: row.samesite === 2 ? { sameSite: 'Strict' } : {}),
}));

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-follow-newtab-site-control',
	method: 'real Chrome 157 with production SPECTRA extension NOT loaded; same signed-in cookie injection; real trusted click on the /follow live card',
	extensionLoaded: false,
	injectedCookieCount: cookies.length,
	chromeVersion: null,
	steps: {},
	errors: [],
};
const profile = await mkdtemp(join(tmpdir(), 'spectra-newtab-control-'));
let browser;
let page;
try {
	await mkdir(join(profile, 'Default'), { recursive: true });
	browser = await puppeteer.launch({
		executablePath: CHROME,
		headless: process.env.SPECTRA_PROBE_HEADED === '0',
		protocolTimeout: 120_000,
		userDataDir: profile,
		args: ['--no-sandbox', '--disable-setuid-sandbox',
			'--autoplay-policy=no-user-gesture-required',
			'--disable-blink-features=AutomationControlled',
			'--force-device-scale-factor=1', '--window-size=1600,1200'],
	});
	out.chromeVersion = await browser.version();
	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	const injector = await page.createCDPSession();
	await injector.send('Network.enable');
	await injector.send('Network.setCookies', { cookies });
	await injector.detach();
	await page.goto(FOLLOW, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(10_000);
	const pageTargets = () => browser.targets()
		.filter(target => target.type() === 'page').map(target => target.url());
	out.steps.before = pageTargets();
	out.steps.follow = await page.evaluate(() => ({
		href: location.href,
		loginPrompt: /登录后即可关注|扫码登录|验证码登录/u.test(document.body?.textContent ?? ''),
		liveAnchors: [...document.querySelectorAll('a[href]')]
			.filter(anchor => /live\.douyin\.com\/\d+/u.test(anchor.href))
			.slice(0, 4).map(anchor => ({ href: anchor.href.slice(0, 110), target: anchor.getAttribute('target') })),
	}));
	// Same card-discovery rule as the main probe: the first leaf whose text is a
	// live marker, then its first large ancestor to the right of the nav rail.
	const card = await page.evaluate(() => {
		const markers = [...document.querySelectorAll('*')].filter(element =>
			!['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName)
			&& element.childElementCount === 0 && /直播|LIVE/iu.test((element.textContent ?? '').trim())
			&& (element.textContent ?? '').trim().length < 24);
		for (const marker of markers.slice(0, 24)) {
			let node = marker;
			for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
				const rect = node.getBoundingClientRect();
				if (rect.width > 60 && rect.height > 60 && rect.x > 200) {
					return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2),
						cls: String(node.className ?? '').slice(0, 70),
						text: (marker.textContent ?? '').trim().slice(0, 30) };
				}
			}
		}
		return null;
	});
	out.steps.card = card;
	if (card) {
		await page.mouse.click(card.x, card.y);
		await wait(9000);
	}
	out.steps.after = pageTargets();
	out.verdict = {
		clicked: !!card,
		tabCountBefore: out.steps.before.length,
		tabCountAfter: out.steps.after.length,
		newTabOpened: out.steps.after.length > out.steps.before.length,
		note: 'If newTabOpened=true WITHOUT the extension, the extra live tab is the site behaviour, not a SPECTRA action. A byte-identical extension-loaded run is in probe-douyin-follow-live-badge.mjs.',
	};
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 120)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 120)}`));
}
console.log(JSON.stringify(out, null, 2));
