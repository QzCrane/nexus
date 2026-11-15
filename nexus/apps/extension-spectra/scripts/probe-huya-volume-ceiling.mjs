// goal: determine whether Huya's own volume slider can physically reach volume=1.0
// inv: observation only; real Chrome 157 and real/synthetic input on the site's own control, no product edits
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-huya-volume-ceiling.mjs [url]
// output: JSON on stdout; the caller archives it as [E-anecdotal] diagnostic evidence
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_UNDER_TEST = process.argv[2]?.trim()
	|| process.env.SPECTRA_HUYA_PARITY_URL?.trim()
	|| 'https://www.huya.com/102411';
const profile = await mkdtemp(join(tmpdir(), 'spectra-huya-ceiling-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	protocolTimeout: 120_000,
	ignoreDefaultArgs: ['--mute-audio'],
	userDataDir: profile,
	args: ['--no-sandbox', '--disable-setuid-sandbox',
		'--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1', '--window-size=1600,1200'],
});

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'huya-native-volume-ceiling-diagnostic',
	chrome: CHROME,
	url: URL_UNDER_TEST,
	viewport: { width: 1600, height: 1200 },
	method: 'real mouse click and drag plus bounded synthetic pointer/mouse events on Huya .sound-progress; no extension write',
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let page;
try {
	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(4500);

	const readSite = () => page.evaluate(() => {
		const bar = document.querySelector('.sound-bar');
		const progress = document.querySelector('.sound-progress');
		const handle = document.querySelector('.sound-btn');
		const button = document.querySelector('#player-sound-btn');
		const rect = progress?.getBoundingClientRect();
		const handleRect = handle?.getBoundingClientRect();
		const media = [...document.querySelectorAll('video')].map(node => {
			const element = /** @type {HTMLVideoElement} */ (node);
			return { id: element.id, volume: element.volume, paused: element.paused,
				primary: element.id === 'hy-video' };
		});
		return {
			barWidth: bar?.getBoundingClientRect().width ?? null,
			barStyle: bar?.getAttribute('style') ?? null,
			buttonClass: button?.className ?? null,
			buttonTitle: button?.getAttribute('title') ?? null,
			progress: rect ? {
				x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10,
				width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10,
				right: Math.round(rect.right * 10) / 10,
			} : null,
			handle: handleRect ? {
				x: Math.round(handleRect.x * 10) / 10, y: Math.round(handleRect.y * 10) / 10,
				width: Math.round(handleRect.width * 10) / 10, height: Math.round(handleRect.height * 10) / 10,
			} : null,
			media,
		};
	});

	const reveal = async () => {
		await page.evaluate(() => window.scrollTo(0, 420));
		await wait(300);
		const player = await page.$('#player-wrap');
		const box = await player?.boundingBox();
		if (box) {
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await wait(250);
		}
		await (await page.$('#player-sound-btn'))?.hover();
		await wait(500);
	};

	await reveal();
	const baseline = await readSite();
	out.steps.baseline = baseline;
	if (!baseline.progress || !baseline.handle) {
		throw new Error('Huya volume track or handle did not become visible');
	}

	const syntheticAt = (clientX) => page.evaluate((x) => {
		const track = document.querySelector('.sound-progress');
		if (!track) return false;
		const rect = track.getBoundingClientRect();
		const y = rect.top + rect.height / 2;
		const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
		for (const type of ['pointerdown', 'mousedown']) {
			track.dispatchEvent(new MouseEvent(type, { ...base, buttons: 1 }));
		}
		track.dispatchEvent(new MouseEvent('pointermove', { ...base, buttons: 1 }));
		document.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 1 }));
		for (const type of ['pointerup', 'mouseup', 'click']) {
			track.dispatchEvent(new MouseEvent(type, { ...base, buttons: 0 }));
		}
		return true;
	}, clientX);

	// One reveal is enough: synthetic events are dispatched straight onto the
	// site's own track, so repeated real hover/scroll cycles only risk a hung
	// protocol call. The product projection uses exactly this synthetic route.
	await reveal();
	out.steps.synthetic = [];
	for (const offset of [0, 5, 10, 20]) {
		const x = baseline.progress.right + offset;
		try {
			const dispatched = await syntheticAt(x);
			await wait(500);
			out.steps.synthetic.push({ offset, x, dispatched, after: await readSite() });
		} catch (error) {
			out.errors.push(`synthetic ${offset}: ${String(error).slice(0, 160)}`);
		}
	}

	// One real drag past the track's right edge as an independent cross-check.
	out.steps.realDrag = [];
	try {
		await reveal();
		const x = baseline.progress.right + 20;
		const handle = await page.$('.sound-btn');
		const handleBox = await handle?.boundingBox();
		if (handleBox) {
			await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
			await page.mouse.down();
			await page.mouse.move(x, handleBox.y + handleBox.height / 2, { steps: 8 });
			await page.mouse.up();
		}
		await wait(600);
		out.steps.realDrag.push({ x, handleBox, after: await readSite() });
	} catch (error) {
		out.errors.push(`realDrag: ${String(error).slice(0, 160)}`);
	}

	// Keyboard is the other site-owned route to the physical maximum.
	try {
		const focused = await page.evaluate(() => {
			const node = document.querySelector('.sound-btn') || document.querySelector('.sound-progress');
			if (!(node instanceof HTMLElement)) return false;
			node.focus();
			return document.activeElement === node;
		});
		for (const key of ['End', 'ArrowRight', 'ArrowUp']) {
			await page.keyboard.press(key);
			await wait(300);
		}
		out.steps.keyboard = { focused, after: await readSite() };
	} catch (error) {
		out.errors.push(`keyboard: ${String(error).slice(0, 160)}`);
	}

	// Record the site's own global handles and their volume entry points. This
	// answers whether a site-official API can reach 1.0 when the track cannot.
	out.steps.globals = await page.evaluate(() => Object.keys(window)
		.filter(key => /player|volume|hy|video/i.test(key)).slice(0, 40));
	out.steps.siteApi = await page.evaluate(() => {
		const names = ['HYPlayer', 'VPlayer', 'TT_ROOM_PLAYER', 'VPlayerUI', 'hyPlayerConfig'];
		return names.map(key => {
			const value = window[key];
			if (value === undefined || value === null) return { key, kind: 'absent' };
			const kind = typeof value;
			const methods = kind === 'function' || kind === 'object'
				? Object.getOwnPropertyNames(value).filter(name => /volume|mute|sound/i.test(name)).slice(0, 20)
				: [];
			return { key, kind, methods, ctor: value?.constructor?.name ?? null };
		});
	});
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
