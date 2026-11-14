// goal: record the real media shape of public live rooms before claiming a control verdict
// inv: this probe never changes control behaviour; it only observes the shipped browser's DOM truth
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-live-media.mjs <url> [<url> ...]
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const urls = process.argv.slice(2);
if (urls.length === 0) throw new Error('At least one HTTPS live URL is required');

const manifest = await readFile(new URL('../dist/manifest.json', import.meta.url));
const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
const profile = await mkdtemp(join(tmpdir(), 'spectra-live-probe-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	userDataDir: profile,
	args: [
		'--no-sandbox',
		'--disable-setuid-sandbox',
		'--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1',
		'--window-size=1280,960',
	],
});

const results = [];
try {
	for (const url of urls) {
		const page = await browser.newPage();
		const entry = { url, capturedAt: new Date().toISOString(), frames: [], errors: [] };
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await new Promise(resolve => setTimeout(resolve, Number(process.env.PROBE_WAIT_MS ?? 18_000)));
			for (const frame of page.frames()) {
				try {
					entry.frames.push(await frame.evaluate(() => ({
						url: location.href,
						title: document.title,
						media: [...document.querySelectorAll('video,audio')].map(element => {
							const node = /** @type {HTMLMediaElement} */ (element);
							const stream = node.srcObject;
							return {
								tag: node.tagName,
								id: node.id,
								className: String(node.className).slice(0, 100),
								src: (node.currentSrc || node.src || '').slice(0, 200),
								srcObject: stream ? {
									kind: stream.constructor?.name ?? 'unknown',
									videoTracks: typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks().length : null,
									audioTracks: typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks().length : null,
								} : null,
								paused: node.paused,
								currentTime: node.currentTime,
								duration: node.duration,
								volume: node.volume,
								muted: node.muted,
								readyState: node.readyState,
							};
						}),
						iframes: [...document.querySelectorAll('iframe')].map(node => node.src).slice(0, 20),
						liveLinks: [...document.querySelectorAll('a[href]')]
							.map(node => node.href)
							.filter(href => /live\.douyin\.com\/\d+|huya\.com\/\d+/u.test(href))
							.slice(0, 20),
						audioContexts: typeof window.AudioContext === 'function' ? 'available' : 'absent',
					})));
				} catch (error) {
					entry.errors.push({ frame: frame.url(), message: String(error).slice(0, 240) });
				}
			}
		} catch (error) {
			entry.errors.push({ frame: url, message: String(error).slice(0, 240) });
		} finally {
			await page.close().catch(() => undefined);
		}
		results.push(entry);
	}
} finally {
	await browser.close();
}

console.log(JSON.stringify({
	capturedAt: new Date().toISOString(),
	chrome: CHROME,
	manifestSha256,
	method: 'headless Chrome, no extension installed, DOM-only media shape observation',
	question: 'Do public live rooms expose a video-only MediaStream srcObject that the document-output admission requires?',
	results,
}, null, 2));
