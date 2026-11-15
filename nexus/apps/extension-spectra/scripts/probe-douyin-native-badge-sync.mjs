// goal: locate why the Action badge never follows the site's own volume slider
//       until the viewer reloads the page or presses the popup play/pause button once
// inv: real Chrome 157, production dist via CDP Extensions.loadUnpacked, signed-in profile copy,
//      REAL trusted mouse input only (synthetic dispatchEvent has isTrusted=false and would
//      bypass the document-start gesture witness, producing a false negative)
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-native-badge-sync.mjs [url]
// output: JSON on stdout
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
const URL_UNDER_TEST = process.argv[2]?.trim()
	|| process.env.SPECTRA_BADGE_SYNC_URL?.trim()
	|| 'https://live.douyin.com/';
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
	kind: 'douyin-native-badge-sync-phase-probe',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	url: URL_UNDER_TEST,
	viewport: { width: 1600, height: 1200 },
	method: 'headful real Chrome with a throwaway copy of the signed-in profile; production extension loaded via CDP Extensions.loadUnpacked; REAL trusted mouse drags on the site volume slider. Three phases: A=native drag with no extension action, B=one popup play/pause gesture then drag, C=after a full page reload then drag.',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-badge-sync-'));
let browser;
let worker;
let page;
let tabId;
let popup;

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

	// A page-side, read-only witness. sessionStorage survives a reload so the
	// three phases form one timeline. This never writes extension state.
	await page.evaluateOnNewDocument(() => {
		const key = '__spectraBadgeWitness';
		const read = () => {
			try { return JSON.parse(sessionStorage.getItem(key) ?? '{}'); }
			catch { return {}; }
		};
		const write = (value) => {
			try { sessionStorage.setItem(key, JSON.stringify(value)); }
			catch (error) {
				const errors = JSON.parse(sessionStorage.getItem(`${key}.errors`) ?? '[]');
				errors.push(String(error));
				sessionStorage.setItem(`${key}.errors`, JSON.stringify(errors.slice(-4)));
			}
		};
		const bump = (name, detail) => {
			const state = read();
			const list = state[name] ?? [];
			list.push({ at: Date.now(), ...detail });
			state[name] = list.slice(-120);
			write(state);
		};
		window.addEventListener('pointerdown', event => bump('trustedInputs', {
			type: event.type, trusted: event.isTrusted, x: Math.round(event.clientX), y: Math.round(event.clientY),
		}), { capture: true, passive: true });
		window.addEventListener('pointermove', event => {
			if (event.buttons) bump('trustedInputs', {
				type: event.type, trusted: event.isTrusted, x: Math.round(event.clientX), y: Math.round(event.clientY),
			});
		}, { capture: true, passive: true });
		document.addEventListener('volumechange', event => {
			const element = event.composedPath().find(node => node instanceof HTMLMediaElement);
			bump('volumeChanges', {
				trusted: event.isTrusted, volume: element ? Number(element.volume.toFixed(3)) : null,
				muted: element ? element.muted : null,
			});
		}, true);
	});

	// Reproduce the reported route: enter the video portal first, then make a
	// WHOLE-DOCUMENT cross-origin navigation into the live room. A direct open
	// of live.douyin.com is a different document lifecycle and does not show the
	// reported symptom (verified in the first two probe rounds).
	const PORTAL = process.env.SPECTRA_BADGE_SYNC_PORTAL?.trim() || 'https://www.douyin.com/';
	const VIA_PORTAL = process.env.SPECTRA_BADGE_SYNC_VIA_PORTAL !== '0';
	if (VIA_PORTAL) {
		await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await wait(6000);
		out.steps.portal = await page.evaluate(() => ({
			href: location.href, title: document.title,
			mediaCount: document.querySelectorAll('video,audio').length,
			liveLinks: [...document.querySelectorAll('a[href]')]
				.map(node => node.href).filter(href => /live\.douyin\.com/u.test(href)).slice(0, 4),
		}));
		const destination = out.steps.portal.liveLinks[0] || URL_UNDER_TEST;
		out.steps.navigation = { from: page.url(), to: destination,
			crossOrigin: new URL(destination).origin !== new URL(PORTAL).origin };
		await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	} else {
		await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	}
	await wait(9000);
	const identity = await worker.evaluate(async url => {
		const tab = (await chrome.tabs.query({})).find(candidate => candidate.url.startsWith(url.replace(/\/$/, '')));
		if (!tab?.id) throw new Error('Target tab not found');
		return { tabId: tab.id };
	}, URL_UNDER_TEST);
	tabId = identity.tabId;
	out.steps.identity = identity;

	const readSite = () => page.evaluate(() => {
		const volumes = [...document.querySelectorAll('[class*="volume"]')].slice(0, 30).map(node => {
			const rect = node.getBoundingClientRect();
			return { tag: node.tagName, cls: String(node.className).slice(0, 90),
				text: (node.textContent ?? '').trim().slice(0, 24),
				box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
		});
		return {
			href: location.href,
			title: document.title,
			mediaCount: document.querySelectorAll('video,audio').length,
			media: [...document.querySelectorAll('video,audio')].slice(0, 6).map(node => ({
				volume: Number(node.volume.toFixed(3)), muted: node.muted, paused: node.paused,
				hasStream: !!node.srcObject, duration: String(node.duration),
			})),
			nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
			volumeControls: volumes,
			witness: (() => {
				try { return JSON.parse(sessionStorage.getItem('__spectraBadgeWitness') ?? '{}'); }
				catch { return {}; }
			})(),
		};
	});

	const readState = () => worker.evaluate(async id => {
		const snapshotKey = `spectra.control.tab.${id}`;
		const usageKey = `spectra.badge.used.${id}`;
		const snapshot = (await chrome.storage.local.get(snapshotKey))[snapshotKey];
		const usage = (await chrome.storage.session.get(usageKey))[usageKey] === true;
		const fields = {};
		for (const [field, value] of Object.entries(snapshot?.fields ?? {})) {
			fields[field] = { actual: value?.actual ?? null, phase: value?.phase ?? null,
				strategy: value?.strategy ?? null, lastError: value?.lastError ?? null };
		}
		let contentStatus = null;
		let contentError = null;
		try {
			contentStatus = await chrome.tabs.sendMessage(id, {
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id,
				type: 'spectra.content.runtime.status', payload: {},
			});
		} catch (error) { contentError = String(error).slice(0, 180); }
		return {
			badgeText: await chrome.action.getBadgeText({ tabId: id }),
			badgeUsage: usage,
			snapshot: snapshot ? { documentId: snapshot.documentId, generation: snapshot.generation,
				activeMedia: snapshot.activeMedia ?? null, live: snapshot.live ?? null, fields } : null,
			contentStatus: contentStatus?.ok ? contentStatus.data : contentStatus ?? null,
			contentError,
		};
	}, tabId);

	const capture = async (label) => {
		const site = await readSite();
		const state = await readState();
		out.steps[label] = {
			site: { href: site.href, title: site.title, mediaCount: site.mediaCount,
				media: site.media, nativeVolumeText: site.nativeVolumeText,
				volumeControls: site.volumeControls.slice(0, 12) },
			...state,
			witnessCounts: { trustedInputs: (site.witness.trustedInputs ?? []).length,
				volumeChanges: (site.witness.volumeChanges ?? []).length },
			witnessVolumeChanges: (site.witness.volumeChanges ?? []).slice(-12),
		};
		return out.steps[label];
	};

	// Douyin's volume slider is VERTICAL (a 4px-wide, ~124px-tall track) and is
	// collapsed to 0x0 until the volume icon is hovered. A horizontal drag would
	// land on the 32px mute icon instead, which is not the reported gesture.
	const trackGeometry = () => page.evaluate(() => {
		const track = document.querySelector('.douyin-player-volume-slider-track');
		const thumb = document.querySelector('.douyin-player-volume-slider-thumb');
		const number = document.querySelector('.douyin-player-volume-number');
		const rect = track?.getBoundingClientRect();
		const thumbRect = thumb?.getBoundingClientRect();
		if (!rect || rect.height < 20) return null;
		return {
			x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y),
			h: Math.round(rect.height), w: Math.round(rect.width),
			thumbY: thumbRect ? Math.round(thumbRect.y) : null,
			number: number?.textContent?.trim() ?? null,
		};
	});

	// The site collapses the slider on mouseleave and after a popup takes focus.
	// Re-enter from outside the control bar and retry a few times so a phase is
	// never recorded as a pass when the slider simply did not open.
	const revealAndTrack = async () => {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const player = await page.$('video');
			const playerBox = await player?.boundingBox();
			if (playerBox) {
				await page.mouse.move(playerBox.x + playerBox.width / 2,
					playerBox.y + playerBox.height / 2, { steps: 3 });
				await wait(180);
			}
			const icon = await page.$('.douyin-player-volume');
			const iconBox = await icon?.boundingBox();
			if (iconBox) {
				await page.mouse.move(iconBox.x + iconBox.width / 2,
					iconBox.y + iconBox.height / 2, { steps: 5 });
				await wait(650);
			}
			const track = await trackGeometry();
			if (track) return track;
			await wait(350);
		}
		return null;
	};

	// A real trusted VERTICAL drag on the site's own track: press on the current
	// thumb, move to the requested level (0=bottom, 1=top), release. The site's
	// own handler is the only writer of the native volume.
	const realDrag = async (track, ratio) => {
		if (!track) return { ok: false, reason: 'volume track did not expand' };
		const x = track.x;
		const fromY = track.thumbY ?? track.y + Math.round(track.h * (1 - 0.6));
		const toY = Math.round(track.y + track.h * (1 - Math.max(0, Math.min(1, ratio))));
		await page.mouse.move(x, fromY, { steps: 3 });
		await page.mouse.down();
		await page.mouse.move(x, toY, { steps: 14 });
		await wait(180);
		await page.mouse.up();
		await wait(1800);
		return { ok: true, x, fromY, toY, ratio, trackHeight: track.h };
	};

	out.steps.phaseA = { label: 'native VERTICAL drag with NO extension action', drags: [] };
	out.steps.phaseA.before = await capture('phaseABefore');
	for (const ratio of [0.35, 0.8]) {
		const track = await revealAndTrack();
		const drag = await realDrag(track, ratio);
		const after = await capture(`phaseAAt${String(ratio).replace('.', '_')}`);
		out.steps.phaseA.drags.push({ ratio, track, drag, after: {
			badge: after.badgeText, usage: after.badgeUsage,
			site: after.site.nativeVolumeText, media: after.site.media[0] ?? null,
			volumeBase: after.snapshot?.fields?.volumeBase ?? null,
			mediaMuted: after.snapshot?.fields?.mediaMuted ?? null,
			witness: after.witnessCounts,
		} });
	}
	out.steps.phaseA.after = out.steps.phaseA.drags.at(-1);

	out.steps.phaseB = { label: 'one popup play/pause gesture, then native drag' };
	// Open the real Action popup and press its playback button once. This is the
	// exact viewer action in the report, not a background shortcut.
	try {
		const popupUrl = `chrome-extension://${out.extensionId}/popup.html`;
		popup = await browser.newPage();
		await popup.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		await wait(1200);
		const button = await popup.$('.btn-pause');
		if (button) {
			await button.click();
			await wait(1200);
			out.steps.phaseB.gesture = { kind: 'popup .btn-pause click', ok: true };
		} else {
			out.steps.phaseB.gesture = { kind: 'popup .btn-pause click', ok: false, reason: 'button missing' };
		}
		await popup.close().catch(() => undefined);
		popup = null;
	} catch (error) {
		out.steps.phaseB.gesture = { kind: 'popup .btn-pause click', ok: false, reason: String(error).slice(0, 200) };
		if (popup) await popup.close().catch(() => undefined);
		popup = null;
	}
	await page.bringToFront();
	await wait(600);
	out.steps.phaseB = { label: 'one popup play/pause gesture, then native VERTICAL drag', drags: [] };
	out.steps.phaseB.before = await capture('phaseBBefore');
	for (const ratio of [0.35, 0.8]) {
		const track = await revealAndTrack();
		const drag = await realDrag(track, ratio);
		const after = await capture(`phaseBAt${String(ratio).replace('.', '_')}`);
		out.steps.phaseB.drags.push({ ratio, track, drag, after: {
			badge: after.badgeText, usage: after.badgeUsage,
			site: after.site.nativeVolumeText, media: after.site.media[0] ?? null,
			volumeBase: after.snapshot?.fields?.volumeBase ?? null,
			mediaMuted: after.snapshot?.fields?.mediaMuted ?? null,
			witness: after.witnessCounts,
		} });
	}
	out.steps.phaseB.after = out.steps.phaseB.drags.at(-1);

	out.steps.phaseC = { label: 'after a full page reload, then native VERTICAL drag', drags: [] };
	await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(8000);
	out.steps.phaseC.before = await capture('phaseCBefore');
	for (const ratio of [0.35, 0.8]) {
		const track = await revealAndTrack();
		const drag = await realDrag(track, ratio);
		const after = await capture(`phaseCAt${String(ratio).replace('.', '_')}`);
		out.steps.phaseC.drags.push({ ratio, track, drag, after: {
			badge: after.badgeText, usage: after.badgeUsage,
			site: after.site.nativeVolumeText, media: after.site.media[0] ?? null,
			volumeBase: after.snapshot?.fields?.volumeBase ?? null,
			mediaMuted: after.snapshot?.fields?.mediaMuted ?? null,
			witness: after.witnessCounts,
		} });
	}
	out.steps.phaseC.after = out.steps.phaseC.drags.at(-1);

	const siteNumber = (value) => value === null || value === undefined ? null
		: Number(String(value).replace(/[^\d.]/g, ''));
	const following = (phase) => phase.drags.map(({ ratio, drag, after }) => {
		const site = siteNumber(after.site);
		const volume = after.volumeBase?.actual ?? null;
		return { ratio, dragOk: drag.ok, site, elementVolume: after.media?.volume ?? null,
			elementMuted: after.media?.muted ?? null,
			badge: after.badge, usage: after.usage, volumeBase: volume,
			mediaMuted: after.mediaMuted?.actual ?? null,
			badgeMatchesSite: typeof site === 'number' && after.badge !== ''
				&& /^\d+$/u.test(after.badge) ? Math.abs(Number(after.badge) - site) <= 2 : null,
			snapshotMatchesSite: typeof site === 'number' && typeof volume === 'number'
				? Math.abs(volume - site) <= 2 : null,
		};
	});
	out.summary = { phaseA: { beforeBadge: out.steps.phaseA.before.badgeText,
		beforeUsage: out.steps.phaseA.before.badgeUsage, drags: following(out.steps.phaseA) },
	phaseB: { gesture: out.steps.phaseB.gesture, beforeBadge: out.steps.phaseB.before.badgeText,
		beforeUsage: out.steps.phaseB.before.badgeUsage, drags: following(out.steps.phaseB) },
	phaseC: { beforeBadge: out.steps.phaseC.before.badgeText,
		beforeUsage: out.steps.phaseC.before.badgeUsage, drags: following(out.steps.phaseC) } };
} catch (error) {
	out.errors.push(String(error).slice(0, 500));
} finally {
	if (popup) await popup.close().catch(() => undefined);
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
