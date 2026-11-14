// goal: reproduce the huya pause readback mismatch and the two-way volume UI gap on the real site
// inv: observation only; no product source is modified, no control behaviour is added
// usage: SPECTRA_PROBE_LIVE_URL=https://www.huya.com/102411 bun scripts/probe-huya-playback-volume.mjs
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

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js',
	'content-page-media-bridge.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	const bytes = await readFile(join(DIST, file));
	hashes[file] = createHash('sha256').update(bytes).digest('hex');
}

const profile = await mkdtemp(join(tmpdir(), 'spectra-huya-pv-'));
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: true,
	enableExtensions: true,
	ignoreDefaultArgs: ['--mute-audio'],
	userDataDir: profile,
	args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1', '--window-size=1600,1200'],
});

let worker;
let popup;
let page;
const out = {
	capturedAt: new Date().toISOString(),
	scope: 'huya pause-button readback + two-way volume UI parity',
	liveUrl: LIVE_URL,
	chrome: CHROME,
	chromeVersion: null,
	dist: hashes,
	waitMs: WAIT_MS,
	steps: {},
	errors: [],
};

const installRecorder = () => {
	const log = [];
	window.__spectraProbeLog = log;
	const stamp = (entry) => {
		entry.t = Math.round(performance.now());
		entry.stack = String(new Error().stack ?? '').split('\n').slice(2, 5)
			.map(line => line.trim().slice(0, 220)).join(' | ');
		log.push(entry);
		if (log.length > 600) log.shift();
		return entry;
	};
	const prototype = HTMLMediaElement.prototype;
	for (const method of ['play', 'pause']) {
		const original = prototype[method];
		prototype[method] = function (...args) {
			stamp({ world: window.__spectraProbeWorld, kind: `call:${method}`,
				id: this.id, pausedBefore: this.paused });
			return original.apply(this, args);
		};
	}
	for (const field of ['volume', 'muted']) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, field);
		if (!descriptor?.set || !descriptor?.get) continue;
		Object.defineProperty(prototype, field, {
			configurable: true,
			get() { return descriptor.get.call(this); },
			set(value) {
				stamp({ world: window.__spectraProbeWorld, kind: `set:${field}`,
					id: this.id, value, before: descriptor.get.call(this) });
				return descriptor.set.call(this, value);
			},
		});
	}
	const bind = (element) => {
		if (element.__spectraProbeBound) return;
		element.__spectraProbeBound = true;
		for (const type of ['play', 'pause', 'playing', 'volumechange', 'emptied', 'loadstart']) {
			element.addEventListener(type, () => {
				log.push({ t: Math.round(performance.now()), kind: `event:${type}`,
					id: element.id, paused: element.paused, volume: element.volume,
					muted: element.muted });
				if (log.length > 600) log.shift();
			});
		}
	};
	for (const element of document.querySelectorAll('video,audio')) bind(element);
	new MutationObserver(records => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node instanceof HTMLMediaElement) bind(node);
				else if (node instanceof Element) {
					for (const element of node.querySelectorAll('video,audio')) bind(element);
				}
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
	return true;
};

const readRecorder = () => page.evaluate(() => ({
	log: [...(window.__spectraProbeLog ?? [])],
	media: [...document.querySelectorAll('video,audio')].map(element => {
		const node = /** @type {HTMLMediaElement} */ (element);
		const rect = node.getBoundingClientRect();
		const stream = node.srcObject;
		return { tag: node.tagName, id: node.id, className: String(node.className).slice(0, 100),
			src: (node.currentSrc || node.src || '').slice(0, 160),
			stream: stream ? { video: stream.getVideoTracks?.().length ?? null,
				audio: stream.getAudioTracks?.().length ?? null } : null,
			paused: node.paused, volume: node.volume, muted: node.muted,
			readyState: node.readyState, duration: node.duration,
			visibleArea: Math.max(0, rect.width) * Math.max(0, rect.height) };
	}),
}));

const readSiteUi = () => page.evaluate(() => {
	const describe = (node) => {
		const rect = node.getBoundingClientRect();
		return { tag: node.tagName, id: node.id, className: String(node.className).slice(0, 120),
			title: node.getAttribute('title'), ariaLabel: node.getAttribute('aria-label'),
			ariaValueNow: node.getAttribute('aria-valuenow'), role: node.getAttribute('role'),
			value: /** @type {any} */ (node).value ?? null,
			text: (node.textContent ?? '').trim().slice(0, 40),
			rect: { x: Math.round(rect.x), y: Math.round(rect.y),
				width: Math.round(rect.width), height: Math.round(rect.height) },
			html: node.outerHTML.slice(0, 320) };
	};
	const visible = (node) => {
		const rect = node.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const candidates = [...document.querySelectorAll('*')].filter(node => {
		if (!(node instanceof HTMLElement) || !visible(node)) return false;
		const label = [String(node.className), node.getAttribute('title') ?? '',
			node.getAttribute('aria-label') ?? '', node.getAttribute('role') ?? '',
			(node.textContent ?? '').slice(0, 30)].join(' ');
		return /volume|音量|静音|mute|播放|暂停|play|pause/i.test(label);
	});
	return { url: location.href, title: document.title,
		controls: candidates.slice(0, 60).map(describe),
		sliders: [...document.querySelectorAll('[role="slider"],input[type="range"]')]
			.filter(visible).slice(0, 20).map(describe),
		volumeNumbers: [...document.querySelectorAll('*')]
			.filter(node => node instanceof HTMLElement && node.children.length === 0 && visible(node)
				&& /^\d{1,3}$/.test((node.textContent ?? '').trim()))
			.slice(0, 25).map(describe) };
});

const readSnapshot = (tabId) => worker.evaluate(async id => {
	const snapshot = (await chrome.storage.local.get(`spectra.control.tab.${id}`))[`spectra.control.tab.${id}`];
	if (!snapshot) return null;
	const fields = {};
	for (const [key, value] of Object.entries(snapshot.fields ?? {})) {
		fields[key] = { actual: value?.actual, desired: value?.desired, strategy: value?.strategy,
			phase: value?.phase, lastError: value?.lastError ?? null };
	}
	return { activeMedia: snapshot.activeMedia, live: snapshot.live, phase: snapshot.phase,
		documentOutput: snapshot.documentOutput, outputLevel: snapshot.outputLevel, fields };
}, tabId);

try {
	out.chromeVersion = await browser.version();
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(() => undefined);
	const workerTarget = await browser.waitForTarget(target => target.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()), { timeout: 30_000 });
	out.extensionId = new URL(workerTarget.url()).host;
	worker = await workerTarget.worker();

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	await page.evaluateOnNewDocument(`window.__spectraProbeWorld = 'page'; (${installRecorder.toString()})();`);
	await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await new Promise(resolve => setTimeout(resolve, WAIT_MS));

	const identity = await worker.evaluate(async url => {
		const tab = (await chrome.tabs.query({})).find(candidate => candidate.url === url);
		if (!tab?.id) throw new Error('Live tab not found');
		const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
		return { tabId: tab.id, documentId: frames?.find(frame => frame.frameId === 0)?.documentId ?? null };
	}, page.url());
	out.steps.identity = identity;
	const { tabId } = identity;

	// The extension's own isolated world is a second wrapper. Install the same
	// recorder there so a replay performed by product code is attributable.
	// The body is inlined (not eval'd) because an injected extension script may
	// be subject to a no-eval content security policy.
	out.steps.isolatedRecorder = await worker.evaluate(async id => {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: id, frameIds: [0] }, world: 'ISOLATED',
			func: (world) => {
				const log = [];
				window.__spectraProbeLog = log;
				window.__spectraProbeWorld = world;
				const stamp = (entry) => {
					entry.t = Math.round(performance.now());
					entry.stack = String(new Error().stack ?? '').split('\n').slice(2, 5)
						.map(line => line.trim().slice(0, 220)).join(' | ');
					log.push(entry);
					if (log.length > 600) log.shift();
					return entry;
				};
				const prototype = HTMLMediaElement.prototype;
				for (const method of ['play', 'pause']) {
					const original = prototype[method];
					prototype[method] = function (...args) {
						stamp({ world, kind: `call:${method}`, id: this.id, pausedBefore: this.paused });
						return original.apply(this, args);
					};
				}
				for (const field of ['volume', 'muted']) {
					const descriptor = Object.getOwnPropertyDescriptor(prototype, field);
					if (!descriptor?.set || !descriptor?.get) continue;
					Object.defineProperty(prototype, field, {
						configurable: true,
						get() { return descriptor.get.call(this); },
						set(value) {
							stamp({ world, kind: `set:${field}`, id: this.id, value,
								before: descriptor.get.call(this) });
							return descriptor.set.call(this, value);
						},
					});
				}
				const bind = (element) => {
					if (element.__spectraProbeBound) return;
					element.__spectraProbeBound = true;
					for (const type of ['play', 'pause', 'playing', 'volumechange', 'emptied', 'loadstart']) {
						element.addEventListener(type, () => {
							log.push({ t: Math.round(performance.now()), kind: `event:${type}`,
								id: element.id, paused: element.paused, volume: element.volume,
								muted: element.muted });
							if (log.length > 600) log.shift();
						});
					}
				};
				for (const element of document.querySelectorAll('video,audio')) bind(element);
				new MutationObserver(records => {
					for (const record of records) for (const node of record.addedNodes) {
						if (node instanceof HTMLMediaElement) bind(node);
						else if (node instanceof Element) {
							for (const element of node.querySelectorAll('video,audio')) bind(element);
						}
					}
				}).observe(document.documentElement, { childList: true, subtree: true });
				return true;
			},
			args: ['isolated'],
		});
		return result?.result ?? null;
	}, tabId).catch(error => ({ error: String(error).slice(0, 300) }));

	out.steps.siteBefore = await readSiteUi();
	// Huya keeps its control bar below the initial viewport and reveals the
	// volume slider only on hover. Scroll and hover with real input, then record
	// the native control's DOM so the two-way gesture can be driven for real.
	await page.evaluate(() => window.scrollTo(0, 420));
	await new Promise(resolve => setTimeout(resolve, 700));
	const soundButton = await page.$('#player-sound-btn');
	if (!soundButton) out.steps.siteVolumeProbe = { found: false };
	else {
		await soundButton.hover();
		await new Promise(resolve => setTimeout(resolve, 900));
		out.steps.siteVolumeProbe = await page.evaluate(() => {
			const describe = (node) => {
				const rect = node.getBoundingClientRect();
				return { tag: node.tagName, id: node.id, className: String(node.className).slice(0, 140),
					title: node.getAttribute('title'), aria: node.getAttribute('aria-label'),
					ariaValueNow: node.getAttribute('aria-valuenow'), role: node.getAttribute('role'),
					text: (node.textContent ?? '').trim().slice(0, 30),
					rect: { x: Math.round(rect.x), y: Math.round(rect.y),
						width: Math.round(rect.width), height: Math.round(rect.height) },
					html: node.outerHTML.slice(0, 420) };
			};
			const visible = (node) => {
				const rect = node.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			};
			const nodes = [...document.querySelectorAll('*')].filter(node => node instanceof HTMLElement
				&& visible(node)
				&& /sound|volume|音量|slider|drag|bar|panel|progress/i.test(
					[String(node.className), node.id, node.getAttribute('title') ?? ''].join(' ')));
			return { found: true, button: describe(document.querySelector('#player-sound-btn')),
				controls: nodes.slice(0, 50).map(describe),
				elementVolume: [...document.querySelectorAll('video')]
					.map(element => ({ id: element.id, volume: /** @type {HTMLMediaElement} */ (element).volume })) };
		});
	}
	const readSiteVolume = () => page.evaluate(() => {
		const bar = document.querySelector('.sound-bar');
		const progress = document.querySelector('.sound-progress');
		const button = document.querySelector('#player-sound-btn');
		const rect = progress?.getBoundingClientRect();
		return { buttonClass: button?.className ?? null,
			barStyle: bar?.getAttribute('style') ?? null,
			barWidth: bar?.getBoundingClientRect().width ?? null,
			progress: rect ? { x: Math.round(rect.x), y: Math.round(rect.y),
				width: Math.round(rect.width), height: Math.round(rect.height) } : null,
			media: [...document.querySelectorAll('video,audio')].map(element => {
				const node = /** @type {HTMLMediaElement} */ (element);
				return { id: node.id, volume: node.volume, muted: node.muted };
			}) };
	});
	const readBadge = () => worker.evaluate(async id => ({
		text: await chrome.action.getBadgeText({ tabId: id }),
	}), tabId).catch(error => ({ error: String(error).slice(0, 200) }));

	if (process.env.SPECTRA_PROBE_SITE_GESTURE === '1') {
		const targetRatio = Number(process.env.SPECTRA_PROBE_SITE_RATIO ?? 0.2);
		const before = { site: await readSiteVolume(), snapshot: await readSnapshot(tabId),
			badge: await readBadge() };
		const box = before.site.progress;
		if (!box) throw new Error('Huya sound-progress is not visible after hover');
		// Reveal the control bar with real pointer movement, then drag the site's
		// own volume handle to the target ratio exactly as a viewer would.
		const player = await page.$('#player-wrap');
		const playerBox = await player?.boundingBox();
		if (playerBox) {
			await page.mouse.move(playerBox.x + playerBox.width / 2,
				playerBox.y + playerBox.height / 2);
			await new Promise(resolve => setTimeout(resolve, 350));
		}
		await (await page.$('#player-sound-btn'))?.hover();
		const handle = await page.$('.sound-btn');
		const handleBox = await handle?.boundingBox();
		const attempts = [];
		if (handleBox) {
			await page.mouse.move(handleBox.x + handleBox.width / 2,
				handleBox.y + handleBox.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * targetRatio,
				handleBox.y + handleBox.height / 2, { steps: 10 });
			await page.mouse.up();
			attempts.push('drag-sound-btn');
		}
		await new Promise(resolve => setTimeout(resolve, 900));
		const mid = await readSiteVolume();
		if (Math.abs((mid.barWidth ?? 0) - box.width * targetRatio) > 6) {
			await page.mouse.click(box.x + box.width * targetRatio, box.y + box.height / 2);
			attempts.push('click-sound-progress');
		}
		await new Promise(resolve => setTimeout(resolve, 1200));
		out.steps.siteGesture = { targetRatio, attempts, handleBox, before,
			mid: { site: mid, snapshot: await readSnapshot(tabId) },
			after: { site: await readSiteVolume(), snapshot: await readSnapshot(tabId),
				badge: await readBadge(), page: await readRecorder() } };
	}

	out.steps.pageBefore = await readRecorder();
	out.steps.snapshotBefore = await readSnapshot(tabId);

	const known = new Set(browser.targets());
	const pending = browser.waitForTarget(target => !known.has(target)
		&& target.url().startsWith(`chrome-extension://${out.extensionId}/popup.html`), { timeout: 20_000 });
	const session = await browser.target().createCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
		const tab = targetInfos.find(target => target.url === page.url());
		if (!tab) throw new Error('Live tab target is missing');
		await session.send('Extensions.triggerAction', { id: out.extensionId, targetId: tab.targetId });
	} finally { await session.detach(); }
	popup = await (await pending).asPage();

	await popup.evaluate(() => {
		const original = chrome.runtime.sendMessage.bind(chrome.runtime);
		/** @type {any[]} */ (window).__probeResponses = [];
		// @ts-expect-error probe-only wrapper
		chrome.runtime.sendMessage = (...args) => {
			const entry = { request: args[0], response: null, error: null };
			/** @type {any[]} */ (window).__probeResponses.push(entry);
			const result = original(...args);
			Promise.resolve(result).then(value => { entry.response = value; },
				error => { entry.error = String(error); });
			return result;
		};
	});

	const card = `.glass-card[data-tab-id="${tabId}"]`;
	await popup.waitForSelector(`${card} .btn-pause`, { timeout: 20_000 });
	await popup.waitForFunction(selector => {
		const button = document.querySelector(`${selector} .btn-pause`);
		return button && button.getAttribute('aria-busy') !== 'true'
			&& button.getAttribute('aria-pressed') !== 'mixed';
	}, { timeout: 20_000 }, card).catch(() => undefined);
	out.steps.popupBefore = await popup.evaluate(selector => {
		const root = document.querySelector(selector);
		const pause = root?.querySelector('.btn-pause');
		const slider = root?.querySelector('.vol-slider');
		return { pause: pause ? { ariaPressed: pause.getAttribute('aria-pressed'),
			html: pause.outerHTML.slice(0, 260) } : null,
		slider: slider ? { value: /** @type {HTMLInputElement} */ (slider).value,
			step: /** @type {HTMLInputElement} */ (slider).step } : null,
		cardText: (root?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) };
	}, card);

	await popup.click(`${card} .btn-pause`);
	await new Promise(resolve => setTimeout(resolve, 2600));
	out.steps.afterPause = {
		responses: await popup.evaluate(() => /** @type {any[]} */ (window).__probeResponses
			.filter(entry => String(entry.request?.type ?? '').startsWith('spectra.control'))
			.map(entry => ({ type: entry.request?.type, operation: entry.request?.payload?.operation,
				patch: entry.request?.payload?.patch, ok: entry.response?.ok ?? null,
				error: entry.response?.error ?? entry.error ?? null,
				fields: entry.response?.data?.fields ?? null }))),
		popup: await popup.evaluate(selector => {
			const root = document.querySelector(selector);
			const pause = root?.querySelector('.btn-pause');
			const slider = root?.querySelector('.vol-slider');
			return { ariaPressed: pause?.getAttribute('aria-pressed') ?? null,
				sliderValue: /** @type {HTMLInputElement} */ (slider)?.value ?? null,
				cardText: (root?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) };
		}, card),
		page: await readRecorder(),
		snapshot: await readSnapshot(tabId),
	};

	// Isolated-world recorder lives on the content script's own window.
	out.steps.isolatedLog = await worker.evaluate(async id => {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: id, frameIds: [0] }, world: 'ISOLATED',
			func: () => [...(window.__spectraProbeLog ?? [])],
		});
		return result?.result ?? null;
	}, tabId).catch(error => ({ error: String(error).slice(0, 300) }));

	// Plugin slider -> site UI. Drive the shipped slider with real key presses.
	const volume = Number(process.env.SPECTRA_PROBE_VOLUME ?? 70);
	const sliderSelector = `${card} .vol-slider`;
	const step = await popup.$eval(sliderSelector,
		element => Number(/** @type {HTMLInputElement} */ (element).step));
	await popup.focus(sliderSelector);
	await popup.keyboard.press('Home');
	for (let index = 0; index < volume / step; index++) await popup.keyboard.press('ArrowRight');
	out.steps.pluginSlider = { requested: volume, step };
	await new Promise(resolve => setTimeout(resolve, 1800));
	out.steps.afterPluginSlider = {
		page: await readRecorder(),
		site: await readSiteUi().then(async site => ({ ...site, sound: await readSiteVolume() })),
		snapshot: await readSnapshot(tabId),
		badge: await readBadge(),
		popup: await popup.evaluate(selector => {
			const root = document.querySelector(selector);
			const slider = root?.querySelector('.vol-slider');
			return { sliderValue: /** @type {HTMLInputElement} */ (slider)?.value ?? null,
				cardText: (root?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) };
		}, card),
	};

	out.steps.badge = await worker.evaluate(async id => {
		const key = `spectra.control.tab.${id}`;
		const snapshot = (await chrome.storage.local.get(key))[key];
		return { activeMedia: snapshot?.activeMedia ?? null, volumeBase: snapshot?.fields?.volumeBase?.actual ?? null };
	}, tabId);

	if (process.env.SPECTRA_PROBE_DOM_VOLUME === '1') {
		// Diagnostic only: can an external write to the media element's volume
		// move Huya's own volume bar? This decides whether the extension needs a
		// site-UI projection or can reuse the existing native setter.
		const experimentValue = Number(process.env.SPECTRA_PROBE_DOM_VOLUME_VALUE ?? 0.8);
		const before = { site: await readSiteVolume(), snapshot: await readSnapshot(tabId),
			badge: await readBadge() };
		await page.evaluate(value => {
			const video = document.querySelector('#hy-video');
			if (!video) throw new Error('hy-video is missing');
			/** @type {HTMLMediaElement} */ (video).volume = value;
		}, experimentValue);
		await new Promise(resolve => setTimeout(resolve, 1400));
		out.steps.domVolumeExperiment = { experimentValue, before,
			after: { site: await readSiteVolume(), snapshot: await readSnapshot(tabId),
				badge: await readBadge(), page: await readRecorder() } };
	}

	if (process.env.SPECTRA_PROBE_SITE_PAUSE === '1') {
		const readPlayback = () => page.evaluate(() => {
			const button = document.querySelector('#player-btn');
			const media = [...document.querySelectorAll('video')].map(element => {
				const node = /** @type {HTMLMediaElement} */ (element);
				return { id: node.id, paused: node.paused };
			});
			return { buttonClass: button?.className ?? null,
				buttonTitle: button?.getAttribute('title') ?? null, media };
		});
		const before = { site: await readPlayback(), snapshot: await readSnapshot(tabId) };
		const player = await page.$('#player-wrap');
		const playerBox = await player?.boundingBox();
		if (playerBox) {
			await page.mouse.move(playerBox.x + playerBox.width / 2,
				playerBox.y + playerBox.height / 2);
			await new Promise(resolve => setTimeout(resolve, 350));
		}
		await page.click('#player-btn');
		await new Promise(resolve => setTimeout(resolve, 1400));
		const paused = { site: await readPlayback(), snapshot: await readSnapshot(tabId),
			page: await readRecorder() };
		await page.click('#player-btn');
		await new Promise(resolve => setTimeout(resolve, 900));
		const resumed = { site: await readPlayback(), snapshot: await readSnapshot(tabId) };
		out.steps.sitePlaybackGesture = { before, paused, resumed };
	}
	if (process.env.SPECTRA_PROBE_SYNTHETIC === '1') {
		// Diagnostic only: can a non-CDP, extension-side synthetic input drive
		// Huya's own controls and is there a page-global player API?
		const globals = await page.evaluate(() => {
			/** @type {Record<string, unknown>} */ const found = {};
			for (const key of Object.keys(window)) {
				if (!/player|huya|volume|video/i.test(key)) continue;
				try {
					const value = /** @type {any} */ (window)[key];
					if (value && typeof value === 'object') {
						const methods = [];
						let proto = value;
						for (let depth = 0; depth < 3 && proto; depth += 1) {
							for (const name of Object.getOwnPropertyNames(proto)) {
								if (/volume|mute|play|pause/i.test(name)
									&& typeof value[name] === 'function') methods.push(name);
							}
							proto = Object.getPrototypeOf(proto);
						}
						found[key] = { type: typeof value, methods: [...new Set(methods)].slice(0, 24) };
					} else found[key] = { type: typeof value };
				} catch (error) { found[key] = { error: String(error).slice(0, 80) }; }
			}
			return found;
		});
		const syntheticPlaybackBefore = await page.evaluate(() => ({
			button: document.querySelector('#player-btn')?.className ?? null,
			media: [...document.querySelectorAll('video')].map(element => ({
				id: element.id, paused: /** @type {HTMLMediaElement} */ (element).paused })),
		}));
		await page.evaluate(() => {
			const button = document.querySelector('#player-btn');
			button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		});
		await new Promise(resolve => setTimeout(resolve, 900));
		const syntheticPlaybackAfter = await page.evaluate(() => ({
			button: document.querySelector('#player-btn')?.className ?? null,
			media: [...document.querySelectorAll('video')].map(element => ({
				id: element.id, paused: /** @type {HTMLMediaElement} */ (element).paused })),
		}));
		// Restore the site's playback state with the same synthetic input.
		await page.evaluate(() => {
			const button = document.querySelector('#player-btn');
			button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		});
		await new Promise(resolve => setTimeout(resolve, 600));
		const syntheticVolumeBefore = await readSiteVolume();
		await page.evaluate(ratio => {
			const progress = document.querySelector('.sound-progress');
			if (!progress) return;
			const rect = progress.getBoundingClientRect();
			const x = rect.left + rect.width * ratio;
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
		}, 0.8);
		await new Promise(resolve => setTimeout(resolve, 1000));
		out.steps.synthetic = { globals, syntheticPlaybackBefore, syntheticPlaybackAfter,
			syntheticVolumeBefore, syntheticVolumeAfter: await readSiteVolume(),
			snapshot: await readSnapshot(tabId) };
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
