// goal: watch the shipped extension's own selection and volume state across Douyin's video -> live switch
// inv: observation only; no product source changes and no new control mechanism
// usage: NEXUS_CHROME_EXECUTABLE="..." SPECTRA_SWITCH_URL="https://live.douyin.com/" bun scripts/probe-douyin-switch-control.mjs
// env: SPECTRA_SWITCH_SAMPLES, SPECTRA_SWITCH_INTERVAL_MS, SPECTRA_SWITCH_VOLUME (enables one popup gesture)
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_UNDER_TEST = process.env.SPECTRA_SWITCH_URL?.trim() || 'https://live.douyin.com/';
const SAMPLES = Number(process.env.SPECTRA_SWITCH_SAMPLES ?? 24);
const INTERVAL_MS = Number(process.env.SPECTRA_SWITCH_INTERVAL_MS ?? 700);
const VOLUME = process.env.SPECTRA_SWITCH_VOLUME?.trim();
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js', 'content-bootstrap.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
}

const profile = await mkdtemp(join(tmpdir(), 'spectra-douyin-switch-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	enableExtensions: true,
	ignoreDefaultArgs: ['--mute-audio'],
	userDataDir: profile,
	args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1', '--window-size=1600,1200'],
});

const out = {
	capturedAt: new Date().toISOString(),
	url: URL_UNDER_TEST,
	chrome: CHROME,
	dist: hashes,
	viewport: { width: 1600, height: 1200 },
	method: 'shipped production extension loaded via CDP Extensions.loadUnpacked; repeated shipped-state sampling',
	samples: [],
	intent: null,
	diagnostics: null,
	errors: [],
};

let worker;
let page;
let popup;
try {
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(() => undefined);
	const workerTarget = await browser.waitForTarget(target => target.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()), { timeout: 30_000 });
	out.extensionId = new URL(workerTarget.url()).host;
	worker = await workerTarget.worker();

	// Passive instrumentation: record every shipped actual-read response and
	// every control snapshot write. Nothing here changes control behaviour.
	await worker.evaluate(() => {
		const probe = { reads: [], changes: [] };
		/** @type {any} */ (globalThis).__spectraSwitchProbe = probe;
		const originalSend = chrome.tabs.sendMessage.bind(chrome.tabs);
		/** @type {any} */ (chrome.tabs).sendMessage = (/** @type {any[]} */ ...args) => {
			const message = args[1];
			const result = originalSend(...args);
			if (message?.type === 'spectra.control.actual.read') {
				Promise.resolve(result).then(response => {
					probe.reads.push({
						at: Date.now(),
						fields: message.payload?.fields ?? null,
						requestTarget: message.payload?.target ?? null,
						ok: response?.ok ?? null,
						target: response?.data?.target ?? null,
						patch: response?.data?.patch ?? null,
						error: response?.error ?? null,
					});
				}).catch(error => probe.reads.push({ at: Date.now(), transportError: String(error).slice(0, 200) }));
			}
			return result;
		};
		chrome.storage.local.onChanged.addListener(changes => {
			for (const [key, change] of Object.entries(changes)) {
				if (!key.startsWith('spectra.control.tab.')) continue;
				const snapshot = /** @type {any} */ (change).newValue;
				if (!snapshot) continue;
				probe.changes.push({
					at: Date.now(), key,
					activeMedia: snapshot.activeMedia ?? null,
					volumeBase: snapshot.fields?.volumeBase?.actual ?? null,
					phase: snapshot.fields?.volumeBase?.phase ?? null,
					generation: snapshot.generation ?? null,
					mediaObservation: snapshot.mediaObservation ?? null,
				});
			}
		});
	});

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	const pagePromise = page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await pagePromise;

	const readShippedState = async (index) => {
		const dom = await page.evaluate(() => {
			const media = [...document.querySelectorAll('video,audio')].map(element => {
				const node = /** @type {HTMLMediaElement} */ (element);
				const stream = node.srcObject;
				const box = node.getBoundingClientRect();
				return {
					id: node.id, tag: node.tagName,
					className: String(node.className).slice(0, 80),
					stream: stream ? {
						video: typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks().length : null,
						audio: typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks().length : null,
					} : null,
					duration: Number.isFinite(node.duration) ? Math.round(node.duration * 10) / 10 : String(node.duration),
					paused: node.paused, volume: node.volume, muted: node.muted,
					readyState: node.readyState, connected: node.isConnected,
					area: Math.round(Math.max(0, box.width) * Math.max(0, box.height)),
				};
			});
			const number = document.querySelector('.douyin-player-volume-number');
			const slider = document.querySelector('[class*=volume-slider]');
			return {
				href: location.href, media,
				siteVolumeNumber: number?.textContent?.trim() ?? null,
				siteVolumeClass: slider ? String(slider.className) : null,
			};
		});

		const shipped = await worker.evaluate(async () => {
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			const tabId = tabs[0]?.id ?? null;
			if (tabId === null) return { tabId: null };
			const key = `spectra.control.tab.${tabId}`;
			const snapshot = (await chrome.storage.local.get(key))[key];
			let badge = null;
			let badgeError = null;
			try { badge = await chrome.action.getBadgeText({ tabId }); }
			catch (error) { badgeError = String(error).slice(0, 160); }
			return {
				tabId, badge, badgeError,
				snapshot: snapshot ? {
					activeMedia: snapshot.activeMedia,
					fields: snapshot.fields,
					live: snapshot.live,
					strategy: snapshot.strategy,
					generation: snapshot.generation,
					origin: snapshot.origin,
				} : null,
			};
		});
		const registry = shipped.tabId === null ? null : await worker.evaluate(async id => {
			const [result] = await chrome.scripting.executeScript({
				target: { tabId: id, frameIds: [0] }, world: 'ISOLATED',
				func: () => {
					const runtime = /** @type {any} */ (globalThis).__SPECTRA_CONTENT_RUNTIME__;
					const digests = [];
					const scanErrors = [];
					const seen = new Set();
					let visited = 0;
					const scan = (value, depth) => {
						if (!value || typeof value !== 'object' || depth > 6 || visited > 3000 || seen.has(value)) return;
						visited++;
						seen.add(value);
						if (typeof value.describeMedia === 'function') {
							try { digests.push(value.describeMedia()); }
							catch (error) { scanErrors.push(String(error).slice(0, 160)); }
							return;
						}
						for (const key of Object.keys(value)) {
							try {
								const child = value[key];
								if (child && typeof child === 'object') scan(child, depth + 1);
							} catch (error) { scanErrors.push(String(error).slice(0, 160)); }
						}
					};
					scan(runtime, 0);
					return {
						present: Boolean(runtime),
						digests: digests.slice(0, 2),
						scanErrors: scanErrors.slice(0, 4),
						media: [...document.querySelectorAll('video,audio')].map(element => {
							const node = /** @type {HTMLMediaElement} */ (element);
							const box = node.getBoundingClientRect();
							return { id: node.id, paused: node.paused, ended: node.ended,
								area: Math.round(Math.max(0, box.width) * Math.max(0, box.height)),
								duration: Number.isFinite(node.duration) ? Math.round(node.duration) : String(node.duration),
								connected: node.isConnected };
						}),
					};
				},
			});
			return result?.result ?? null;
		}, shipped.tabId);
		return { index, at: new Date().toISOString(), dom, shipped, registry };
	};

	for (let index = 0; index < SAMPLES; index += 1) {
		out.samples.push(await readShippedState(index));
		await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
	}

	if (VOLUME) {
		// One trusted toolbar gesture after the switch, to test whether control
		// and the site's own UI still land on the live player.
		const known = new Set(browser.targets());
		const pending = browser.waitForTarget(target => !known.has(target)
			&& target.url().startsWith(`chrome-extension://${out.extensionId}/popup.html`), { timeout: 20_000 });
		const session = await browser.target().createCDPSession();
		try {
			const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
			const tab = targetInfos.find(target => target.url === page.url());
			if (!tab) throw new Error('page target is missing');
			await session.send('Extensions.triggerAction', { id: out.extensionId, targetId: tab.targetId });
		} finally { await session.detach(); }
		popup = await (await pending).asPage();
		const tabId = out.samples.at(-1)?.shipped.tabId;
		out.intent = await popup.evaluate(async ({ id, value }) => chrome.runtime.sendMessage({
			protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.intent.submit', tabId: id,
			payload: { tabId: id, source: 'popup', requestedCoverage: 'active-target', target: null,
				patch: { volumeBase: Number(value) } },
		}), { id: tabId, value: VOLUME });
		for (let index = 0; index < 6; index += 1) {
			await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
			out.samples.push({ ...await readShippedState(SAMPLES + index), afterIntent: true });
		}
	}
	out.diagnostics = await worker.evaluate(() => /** @type {any} */ (globalThis).__spectraSwitchProbe ?? null);
} catch (error) {
	out.errors.push(String(error).slice(0, 400));
} finally {
	if (popup) await popup.close().catch(() => undefined);
	if (page) await page.close().catch(() => undefined);
	await browser.close();
}

console.log(JSON.stringify(out, null, 2));
