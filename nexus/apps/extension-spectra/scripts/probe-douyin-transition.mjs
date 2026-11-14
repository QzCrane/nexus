// goal: observe the real video -> live transition on Douyin instead of guessing from fixtures
// inv: observation only; this probe never changes control behaviour or product source
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-transition.mjs <url> [<url> ...]
// env: PROBE_SAMPLES (default 8), PROBE_SAMPLE_MS (default 3000), PROBE_CLICK_LIVE (set to 1)
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const urls = process.argv.slice(2);
if (urls.length === 0) throw new Error('At least one URL is required');
const SAMPLES = Number(process.env.PROBE_SAMPLES ?? 8);
const SAMPLE_MS = Number(process.env.PROBE_SAMPLE_MS ?? 3000);
const CLICK_LIVE = process.env.PROBE_CLICK_LIVE === '1';

const profile = await mkdtemp(join(tmpdir(), 'spectra-douyin-transition-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	userDataDir: profile,
	args: [
		'--no-sandbox',
		'--disable-setuid-sandbox',
		'--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1',
		'--window-size=1600,1200',
	],
});

const snapshot = () => ({
	href: location.href,
	title: document.title,
	captcha: [...document.querySelectorAll('iframe')]
		.map(frame => frame.src)
		.filter(src => /verify|captcha|secsdk/u.test(src))
		.slice(0, 5),
	media: [...document.querySelectorAll('video,audio')].map(element => {
		const node = /** @type {HTMLMediaElement} */ (element);
		const stream = node.srcObject;
		const box = node.getBoundingClientRect();
		return {
			tag: node.tagName,
			id: node.id,
			className: String(node.className).slice(0, 120),
			src: (node.currentSrc || node.src || '').slice(0, 160),
			srcObject: stream ? {
				videoTracks: typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks().length : null,
				audioTracks: typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks().length : null,
			} : null,
			paused: node.paused,
			ended: node.ended,
			currentTime: Math.round(node.currentTime * 10) / 10,
			duration: Number.isFinite(node.duration) ? Math.round(node.duration * 10) / 10 : String(node.duration),
			volume: node.volume,
			muted: node.muted,
			readyState: node.readyState,
			connected: node.isConnected,
			box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
		};
	}),
	// The site's own volume widget is the truth for "native UI follows".
	volumeUi: [...document.querySelectorAll('[class*=volume],[class*=Volume],[class*=muted],[class*=Muted]')]
		.slice(0, 14)
		.map(node => ({
			tag: node.tagName,
			className: String(node.className).slice(0, 120),
			text: (node.textContent ?? '').trim().slice(0, 40),
			ariaValue: node.getAttribute('aria-valuenow'),
		})),
	liveLinks: [...document.querySelectorAll('a[href]')]
		.map(node => ({ href: node.href, text: (node.textContent ?? '').trim().slice(0, 40) }))
		.filter(link => /live\.douyin\.com/u.test(link.href))
		.slice(0, 12),
});

const out = {
	capturedAt: new Date().toISOString(),
	chrome: CHROME,
	viewport: { width: 1600, height: 1200 },
	samples: SAMPLES,
	sampleMs: SAMPLE_MS,
	clickLive: CLICK_LIVE,
	method: 'headless Chrome, no extension installed, repeated DOM snapshots across the transition',
	results: [],
};

try {
	for (const url of urls) {
		const page = await browser.newPage();
		await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
		const entry = { url, navigations: [], timeline: [], errors: [] };
		page.on('framenavigated', frame => {
			if (frame === page.mainFrame()) {
				entry.navigations.push({ at: new Date().toISOString(), href: frame.url() });
			}
		});
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			for (let index = 0; index < SAMPLES; index += 1) {
				await new Promise(resolve => setTimeout(resolve, SAMPLE_MS));
				const state = await page.evaluate(snapshot);
				entry.timeline.push({ index, at: new Date().toISOString(), ...state });
			}
			if (CLICK_LIVE) {
				const clicked = await page.evaluate(() => {
					const link = [...document.querySelectorAll('a[href]')]
						.find(node => /live\.douyin\.com\/\d+/u.test(node.href));
					if (!link) return null;
					link.click();
					return link.href;
				});
				entry.clickedLink = clicked;
				if (clicked) {
					for (let index = 0; index < SAMPLES; index += 1) {
						await new Promise(resolve => setTimeout(resolve, SAMPLE_MS));
						const state = await page.evaluate(snapshot);
						entry.timeline.push({ index: SAMPLES + index, afterClick: true, at: new Date().toISOString(), ...state });
					}
				}
			}
		} catch (error) {
			entry.errors.push(String(error).slice(0, 300));
		} finally {
			await page.close().catch(() => undefined);
		}
		out.results.push(entry);
	}
} finally {
	await browser.close();
}

console.log(JSON.stringify(out, null, 2));
