// goal: reproduce the exact reported route -- www.douyin.com/follow -> click a live card
//       -> SAME-DOCUMENT SPA route into the live room -> native volume slider with NO extension action
// inv: real Chrome 157 headful, signed-in profile copy, production dist via CDP Extensions.loadUnpacked,
//      REAL trusted mouse input (isTrusted) on the site's own control; observation only, no product writes
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-follow-spa-badge.mjs
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
const FOLLOW = process.env.SPECTRA_FOLLOW_URL?.trim() || 'https://www.douyin.com/follow';
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
	kind: 'douyin-follow-spa-native-badge-sync-proof',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	follow: FOLLOW,
	viewport: { width: 1600, height: 1200 },
	method: 'headful real Chrome with a throwaway copy of the signed-in profile; production extension loaded via CDP Extensions.loadUnpacked. Open /follow, REAL trusted click on a live card, wait for the same-document SPA route, then a REAL trusted drag on the site vertical volume slider with NO extension action. Then one popup play/pause gesture and a reload as the reported unblock paths.',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-follow-spa-'));
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

	// Read-only page-side witness: trusted inputs, native volumechange, and the
	// document identity (to prove the SPA swap did NOT create a new document).
	await page.evaluateOnNewDocument(() => {
		const key = '__spectraFollowWitness';
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
			state[name] = list.slice(-160);
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
		const state = read();
		state.documents = (state.documents ?? []).concat([{ at: Date.now(), href: location.href }]).slice(-8);
		write(state);
	});

	await page.goto(FOLLOW, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(9000);

	const readSite = () => page.evaluate(() => {
		const volumes = [...document.querySelectorAll('[class*="volume"]')].slice(0, 20).map(node => {
			const rect = node.getBoundingClientRect();
			return { cls: String(node.className).slice(0, 90),
				text: (node.textContent ?? '').trim().slice(0, 20),
				box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
		});
		return {
			href: location.href, title: document.title,
			mediaCount: document.querySelectorAll('video,audio').length,
			media: [...document.querySelectorAll('video,audio')].slice(0, 8).map(node => ({
				volume: Number(node.volume.toFixed(3)), muted: node.muted, paused: node.paused,
				hasStream: !!node.srcObject, duration: String(node.duration),
			})),
			nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
			volumeControls: volumes,
			witness: (() => {
				try { return JSON.parse(sessionStorage.getItem('__spectraFollowWitness') ?? '{}'); }
				catch { return {}; }
			})(),
		};
	});

	const findLiveCard = () => page.evaluate(() => {
		const anchors = [...document.querySelectorAll('a[href]')];
		const candidates = anchors.filter(node => {
			const href = node.href;
			return /live\.douyin\.com|\/follow\/live|live\/\d+/iu.test(href);
		});
		const scored = candidates.map(node => {
			const rect = node.getBoundingClientRect();
			const text = (node.textContent ?? '').trim().slice(0, 60);
			return { href: node.href, text, x: Math.round(rect.x + rect.width / 2),
				y: Math.round(rect.y + rect.height / 2), w: Math.round(rect.width), h: Math.round(rect.height) };
		}).filter(item => item.w > 8 && item.h > 8 && item.x > 0 && item.y > 0);
		return { total: anchors.length, candidates: scored.slice(0, 14),
			liveBadges: [...document.querySelectorAll('*')]
				.filter(node => node.childElementCount === 0 && /直播中|正在直播|LIVE/u.test((node.textContent ?? '').trim()))
				.slice(0, 8).map(node => ({ tag: node.tagName, cls: String(node.className).slice(0, 70),
					text: (node.textContent ?? '').trim().slice(0, 30) })) };
	});

	out.steps.follow = await readSite();
	out.steps.liveCards = await findLiveCard();

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
		const state = tabId === undefined ? {} : await readState();
		out.steps[label] = {
			site: { href: site.href, title: site.title, mediaCount: site.mediaCount,
				media: site.media, nativeVolumeText: site.nativeVolumeText,
				volumeControls: site.volumeControls.slice(0, 10) },
			...state,
			witnessCounts: { trustedInputs: (site.witness.trustedInputs ?? []).length,
				volumeChanges: (site.witness.volumeChanges ?? []).length },
			documents: site.witness.documents ?? [],
			witnessVolumeChanges: (site.witness.volumeChanges ?? []).slice(-10),
		};
		return out.steps[label];
	};

	const identity = await worker.evaluate(async url => {
		const tab = (await chrome.tabs.query({})).find(candidate => candidate.url.startsWith(url.replace(/\/$/, '')));
		if (!tab?.id) throw new Error('Follow tab not found');
		return { tabId: tab.id };
	}, FOLLOW);
	tabId = identity.tabId;
	out.steps.identity = identity;
	await capture('beforeClick');

	// REAL trusted click on a live card. Prefer a card that stays on the same
	// origin; fall back to the nav link if the follow feed did not render.
	const card = out.steps.liveCards.candidates.find(item => /www\.douyin\.com/u.test(item.href))
		?? out.steps.liveCards.candidates[0];
	if (card) {
		out.steps.click = { ...card, crossOrigin: new URL(card.href).origin !== new URL(FOLLOW).origin };
		await page.mouse.click(card.x, card.y);
		await wait(9000);
	} else {
		out.steps.click = { ok: false, reason: 'no live card found' };
	}
	await capture('afterClick');
	out.steps.afterSameDocument = out.steps.afterClick.documents.length <= 1
		|| out.steps.afterClick.documents.every(entry => entry.href === out.steps.beforeClick.site.href);

	const trackGeometry = () => page.evaluate(() => {
		const track = document.querySelector('.douyin-player-volume-slider-track');
		const thumb = document.querySelector('.douyin-player-volume-slider-thumb');
		const number = document.querySelector('.douyin-player-volume-number');
		const rect = track?.getBoundingClientRect();
		const thumbRect = thumb?.getBoundingClientRect();
		if (!rect || rect.height < 20) return null;
		return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y),
			h: Math.round(rect.height), w: Math.round(rect.width),
			thumbY: thumbRect ? Math.round(thumbRect.y) : null,
			number: number?.textContent?.trim() ?? null };
	});

	const revealAndTrack = async () => {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const player = await page.$('video');
			const playerBox = await player?.boundingBox();
			if (playerBox) {
				await page.mouse.move(playerBox.x + playerBox.width / 2,
					playerBox.y + playerBox.height / 2, { steps: 3 });
				await wait(200);
			}
			const icon = await page.$('.douyin-player-volume');
			const iconBox = await icon?.boundingBox();
			if (iconBox) {
				await page.mouse.move(iconBox.x + iconBox.width / 2,
					iconBox.y + iconBox.height / 2, { steps: 5 });
				await wait(700);
			}
			const track = await trackGeometry();
			if (track) return track;
			await wait(350);
		}
		return null;
	};

	// Douyin's own track is VERTICAL (4px wide, ~124px tall). Real trusted drag.
	const realDrag = async (ratio) => {
		const track = await revealAndTrack();
		if (!track) return { ok: false, reason: 'volume track did not expand', track: null };
		const x = track.x;
		const fromY = track.thumbY ?? track.y + Math.round(track.h * 0.4);
		const toY = Math.round(track.y + track.h * (1 - Math.max(0, Math.min(1, ratio))));
		await page.mouse.move(x, fromY, { steps: 3 });
		await page.mouse.down();
		await page.mouse.move(x, toY, { steps: 14 });
		await wait(180);
		await page.mouse.up();
		await wait(1900);
		return { ok: true, x, fromY, toY, ratio, trackHeight: track.h, track: track.number };
	};

	const dragPhase = async (label) => {
		const result = { label, drags: [] };
		result.before = await capture(`${label}Before`);
		for (const ratio of [0.3, 0.75]) {
			const drag = await realDrag(ratio);
			const after = await capture(`${label}At${String(ratio).replace('.', '_')}`);
			result.drags.push({ ratio, drag, after: {
				badge: after.badgeText, usage: after.badgeUsage,
				site: after.site.nativeVolumeText, media: after.site.media[0] ?? null,
				volumeBase: after.snapshot?.fields?.volumeBase ?? null,
				mediaMuted: after.snapshot?.fields?.mediaMuted ?? null,
				activeMedia: after.snapshot?.activeMedia ?? null,
				contentStatus: after.contentStatus, contentError: after.contentError,
				witness: after.witnessCounts,
			} });
		}
		return result;
	};

	// Phase A: exactly the reported failure -- SPA route completed, no Popup,
	// no hotkey, no extension button pressed at all.
	out.steps.phaseA = await dragPhase('phaseA');

	// Phase B: the first reported unblock path -- one popup play/pause gesture.
	try {
		popup = await browser.newPage();
		await popup.goto(`chrome-extension://${out.extensionId}/popup.html`,
			{ waitUntil: 'domcontentloaded', timeout: 30_000 });
		await wait(1200);
		const button = await popup.$('.btn-pause');
		if (button) { await button.click(); await wait(1200); }
		out.steps.popupGesture = { ok: !!button, kind: 'popup .btn-pause click' };
		await popup.close().catch(() => undefined);
		popup = null;
	} catch (error) {
		out.steps.popupGesture = { ok: false, reason: String(error).slice(0, 200) };
		if (popup) await popup.close().catch(() => undefined);
		popup = null;
	}
	await page.bringToFront();
	await wait(700);
	out.steps.phaseB = await dragPhase('phaseB');

	// Phase C: the second reported unblock path -- a full page reload.
	await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(9000);
	out.steps.phaseC = await dragPhase('phaseC');

	const num = (value) => value === null || value === undefined ? null
		: Number(String(value).replace(/[^\d.]/g, ''));
	const summarise = (phase) => phase.drags.map(({ ratio, drag, after }) => {
		const site = num(after.site);
		const volume = after.volumeBase?.actual ?? null;
		return { ratio, dragOk: drag.ok, dragReason: drag.reason ?? null,
			site, elementVolume: after.media?.volume ?? null, badge: after.badge, usage: after.usage,
			volumeBase: volume, activeMedia: after.activeMedia ?? null,
			ready: after.contentStatus?.ready ?? null,
			badgeMatchesSite: typeof site === 'number' && /^\d+$/u.test(after.badge ?? '')
				? Math.abs(Number(after.badge) - site) <= 2 : null,
			snapshotMatchesSite: typeof site === 'number' && typeof volume === 'number'
				? Math.abs(volume - site) <= 2 : null };
	});
	out.summary = {
		beforeClickBadge: out.steps.beforeClick.badgeText,
		afterClickHref: out.steps.afterClick.site.href,
		afterSameDocument: out.steps.afterSameDocument,
		phaseA: { beforeBadge: out.steps.phaseA.before.badgeText,
			beforeUsage: out.steps.phaseA.before.badgeUsage, drags: summarise(out.steps.phaseA) },
		phaseB: { popupGesture: out.steps.popupGesture,
			beforeBadge: out.steps.phaseB.before.badgeText, drags: summarise(out.steps.phaseB) },
		phaseC: { beforeBadge: out.steps.phaseC.before.badgeText, drags: summarise(out.steps.phaseC) },
	};
} catch (error) {
	out.errors.push(String(error).slice(0, 500));
} finally {
	if (popup) await popup.close().catch(() => undefined);
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
