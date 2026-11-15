// goal: reproduce the exact reported route -- www.douyin.com/follow -> click into a live room -> native volume slider
// inv: real Chrome 157 headful, production dist via CDP Extensions.loadUnpacked, REAL trusted mouse input;
//      observation only, no product writes
// note: the signed-in Douyin session comes from WorkBuddy's built-in browser, whose Electron
//       cookie store keeps clear values in `value` (no Chrome App-Bound Encryption) but holds
//       the live SQLite file under an exclusive lock. `esentutl /y /vss` takes a VSS snapshot;
//       the clear values are read in memory and injected over CDP into a FRESH throwaway Chrome
//       profile. Values are never logged and never written to disk.
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-follow-live-badge.mjs
// output: JSON on stdout
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORK_BUDDY_COOKIE_DB = process.env.SPECTRA_WB_COOKIE_DB?.trim()
	|| join(homedir(), '.workbuddy', 'app', 'session', 'Partitions',
		'agent-browser-preview-webview', 'Network', 'Cookies');
const FOLLOW = 'https://www.douyin.com/follow';
const HEADLESS = process.env.SPECTRA_PROBE_HEADED === '0';
// Douyin opens a _blank live tab AND leaves the same-origin SPA route behind.
// 'active' follows the new tab (the viewer's foreground tab); 'spa' stays on
// the reported "same page navigation" tab so both hypotheses are measurable.
const SAMPLE_TAB = process.env.SPECTRA_SAMPLE_TAB === 'spa' ? 'spa' : 'active';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js',
	'content-bootstrap.js', 'content-page-media-bridge.js', 'popup.js'];
const hashes = {};
for (const file of distFiles) {
	hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
}

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-follow-live-native-badge-sync-proof',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	follow: FOLLOW,
	viewport: { width: 1600, height: 1200 },
	method: 'headful real Chrome 157 with production dist via CDP Extensions.loadUnpacked; a FRESH throwaway profile whose signed-in Douyin cookies come from the WorkBuddy built-in browser (Electron clear-value cookie store, read via a VSS snapshot because the live SQLite file is exclusively locked). Open /follow, REAL-click into a live room, then REAL trusted vertical drag on the site volume slider with NO extension action; then one popup play/pause gesture and a reload as the reported unblock paths.',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'spectra-follow-live-'));
let browser;
let worker;
let page;
let tabId;
let popup;

// WorkBuddy's built-in browser is an Electron webview partition. Its Cookies DB keeps
// the clear values in `value` (verified: sessionid / sid_tt / sid_guard / uid_tt all
// present), but the running app holds the file exclusively. A VSS snapshot is the only
// read-only way to reach it without touching the user's profile. No clear value is ever
// placed in `out`, printed, or written to disk.
const loadWorkBuddyDouyinCookies = async () => {
	const source = WORK_BUDDY_COOKIE_DB.replace(/\//g, '\\');
	await stat(source);
	const snapshotDir = await mkdtemp(join(tmpdir(), 'spectra-wb-vss-'));
	const snapshot = join(snapshotDir, 'Cookies.snapshot').replace(/\//g, '\\');
	try {
		const esentutl = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'esentutl.exe');
		const copy = spawnSync(esentutl, ['/y', source, '/d', snapshot, '/vss'],
			{ encoding: 'utf8', timeout: 60_000, windowsHide: true });
		if (copy.status !== 0 || copy.error) {
			throw new Error(`esentutl /vss failed (status=${copy.status}): ${String(copy.error ?? copy.stdout).slice(0, 180)}`);
		}
		await stat(snapshot);
		const database = new Database(snapshot, { readonly: true });
		let rows;
		try {
			rows = database.query('select host_key,name,value,path,expires_utc,is_secure,is_httponly,samesite '
				+ "from cookies where host_key like '%douyin.com' and length(value) > 0").all();
		} finally {
			database.close();
		}
		const cookies = rows.map(row => ({
			name: row.name,
			value: row.value,
			domain: row.host_key,
			path: row.path || '/',
			...(row.expires_utc > 0
				? { expires: row.expires_utc / 1_000_000 - 11_644_473_600 } : {}),
			httpOnly: row.is_httponly === 1,
			secure: row.is_secure === 1,
			...(row.samesite === 0 ? { sameSite: 'None' }
				: row.samesite === 1 ? { sameSite: 'Lax' }
					: row.samesite === 2 ? { sameSite: 'Strict' } : {}),
		}));
		return {
			cookies,
			meta: {
				source: 'WorkBuddy built-in browser (persist:agent-browser-preview-webview) clear-value Cookies DB via VSS snapshot',
				count: cookies.length,
				loginNames: cookies
					.filter(cookie => /^(sessionid|sid_tt|sid_guard|uid_tt|odin_tt|ssid_ucp_v1)$/u.test(cookie.name))
					.map(cookie => cookie.name),
				domains: [...new Set(cookies.map(cookie => cookie.domain))],
				note: 'Clear values held in process memory only; never logged or written to disk.',
			},
		};
	} finally {
		await rm(snapshotDir, { recursive: true, force: true }).catch(error => {
			out.errors.push(`remove VSS snapshot: ${String(error).slice(0, 120)}`);
		});
	}
};

try {
	await mkdir(join(profile, 'Default'), { recursive: true });
	const loaded = await loadWorkBuddyDouyinCookies();
	const signedInCookies = loaded.cookies;
	out.steps.profilePrepared = {
		mode: 'fresh throwaway Chrome profile; no Chrome cookie store copied',
		profileDir: profile,
	};
	out.steps.cookieInjection = loaded.meta;

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
	out.steps.serviceWorkers = browser.targets()
		.filter(target => target.type() === 'service_worker')
		.map(target => target.url());
	out.steps.extensionCount = new Set(out.steps.serviceWorkers
		.map(url => { try { return new URL(url).host; } catch { return url; } })).size;
	worker = await workerTarget.worker();
	// Read-only witness: a SECOND onMessage listener records the exact control
	// intents the background receives. It never calls sendResponse and returns
	// undefined, so it cannot alter the product's own RPC handling.
	await worker.evaluate(() => {
		const state = { intents: [], errors: [] };
		globalThis.__spectraFollowLiveIntentWitness = state;
		chrome.runtime.onMessage.addListener((message) => {
			try {
				if (!String(message?.type ?? '').includes('control.intent.submit')) return;
				const payload = message.payload ?? {};
				state.intents.push({
					at: Date.now(),
					source: payload.source ?? null,
					userGesture: payload.userGesture ?? null,
					volumeBase: payload.patch?.volumeBase ?? null,
					mediaMuted: payload.patch?.mediaMuted ?? null,
					mediaId: payload.target?.mediaId ?? null,
					targetDocumentId: payload.target?.documentId ?? null,
					observationDocumentId: payload.observationDocumentId ?? null,
				});
				if (state.intents.length > 160) state.intents.splice(0, state.intents.length - 160);
			} catch (error) {
				state.errors.push(String(error).slice(0, 120));
			}
		});
	});

	const installWitness = async (targetPage) => targetPage.evaluateOnNewDocument(() => {
		const key = '__spectraFollowLiveWitness';
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
		// Record the resolved URL after the document commits. Recording at
		// evaluateOnNewDocument time only ever sees about:blank.
		document.addEventListener('DOMContentLoaded', () => {
			const state = read();
			state.documents = (state.documents ?? [])
				.concat([{ at: Date.now(), href: location.href }]).slice(-8);
			write(state);
		}, { once: true });
	});

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
	await installWitness(page);

	const cookieInjector = await page.createCDPSession();
	await cookieInjector.send('Network.enable');
	await cookieInjector.send('Network.setCookies', { cookies: signedInCookies });
	await cookieInjector.detach();
	await page.goto(FOLLOW, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(10_000);

	const readSite = () => page.evaluate(() => {
		const clone = document.body?.cloneNode(true);
		clone?.querySelectorAll('script,style,noscript,template').forEach(node => { node.remove(); });
		const visibleText = (clone?.textContent ?? '').replace(/\s+/g, ' ');
		return {
			href: location.href,
			title: document.title,
			mediaCount: document.querySelectorAll('video,audio').length,
			media: [...document.querySelectorAll('video,audio')].slice(0, 8).map(node => ({
				volume: Number(node.volume.toFixed(3)), muted: node.muted, paused: node.paused,
				hasStream: !!node.srcObject, duration: String(node.duration),
			})),
			nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
			bodySample: visibleText.slice(0, 400),
			bodyLength: visibleText.length,
			loginPrompt: /登录后即可关注|扫码登录|验证码登录/u.test(visibleText),
			witness: (() => {
				try { return JSON.parse(sessionStorage.getItem('__spectraFollowLiveWitness') ?? '{}'); }
				catch { return {}; }
			})(),
		};
	});

	// The follow feed renders live entries as clickable containers, not always anchors.
	// Include the "直播" tab and every concrete room link so the reported route can be
	// told apart from a cross-origin nav link.
	const findLiveCards = () => page.evaluate(() => {
		const rect = (element) => {
			const r = element.getBoundingClientRect();
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
				w: Math.round(r.width), h: Math.round(r.height) };
		};
		const markers = [...document.querySelectorAll('*')].filter(element =>
			!['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName)
			&& element.childElementCount === 0 && /直播|LIVE/iu.test((element.textContent ?? '').trim())
			&& (element.textContent ?? '').trim().length < 24);
		const withAncestors = markers.slice(0, 24).map(element => {
			let node = element;
			const chain = [];
			for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
				chain.push({ tag: node.tagName, cls: String(node.className ?? '').slice(0, 70),
					box: rect(node), href: node.getAttribute?.('href') ?? null });
			}
			return { text: (element.textContent ?? '').trim(), chain };
		});
		const liveAnchors = [...document.querySelectorAll('a[href]')]
			.filter(a => /live\.douyin|\/follow\/live|live\/\d+/iu.test(a.href))
			.map(a => ({ href: a.href, text: (a.textContent ?? '').trim().slice(0, 30),
				target: a.getAttribute('target'), box: rect(a) }))
			.filter(item => item.box.w > 8 && item.box.h > 8);
		const liveTabs = [...document.querySelectorAll('[class*="tab-live"], [class*="live-tab"]')]
			.map(node => ({ cls: String(node.className ?? '').slice(0, 80),
				text: (node.textContent ?? '').trim().slice(0, 30), box: rect(node) }))
			.filter(item => item.box.w > 8 && item.box.h > 8);
		return { markers: withAncestors, liveAnchors, liveTabs };
	});

	out.steps.follow = await readSite();
	out.steps.liveCards = await findLiveCards();

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

	// Every tab's badge/usage, so a newly opened live tab cannot be confused with
	// the /follow tab that stayed behind.
	const tabSnapshot = () => worker.evaluate(async () => {
		const tabs = await chrome.tabs.query({});
		const rows = [];
		for (const tab of tabs) {
			const key = `spectra.badge.used.${tab.id}`;
			rows.push({
				id: tab.id, url: tab.url ?? null, active: tab.active,
				openerTabId: tab.openerTabId ?? null,
				badge: tab.id === undefined ? null : await chrome.action.getBadgeText({ tabId: tab.id }),
				usage: (await chrome.storage.session.get(key))[key] === true,
			});
		}
		return rows;
	});

	const capture = async (label) => {
		const site = await readSite();
		const state = tabId === undefined ? {} : await readState();
		const intents = tabId === undefined ? [] : await worker.evaluate(() =>
			globalThis.__spectraFollowLiveIntentWitness?.intents?.slice(-16) ?? []);
		const tabs = await tabSnapshot();
		const pageTargets = browser.targets()
			.filter(target => target.type() === 'page').map(target => target.url());
	// The trusted-input witness lives in the document-start bootstrap's
	// ISOLATED-world state. Read EVERY frame's stamp, media volumes and the
	// site's own volume label: a player that lives in a child frame while the
	// content script only runs in the top frame is exactly the kind of split
	// that leaves the badge behind a native slider drag.
	const bootstrapFrames = tabId === undefined ? [] : await worker.evaluate(async id => {
		try {
			const frames = await chrome.scripting.executeScript({
				target: { tabId: id, allFrames: true },
				world: 'ISOLATED',
				func: () => {
					const state = window.__SPECTRA_CONTENT_BOOTSTRAP__;
					return {
						href: location.href,
						now: Math.round(performance.now()),
						hasState: !!state,
						gestureAt: state?.mediaUserGestureAt ?? null,
						gestureFresh: typeof state?.mediaUserGestureAt === 'number'
							&& performance.now() - state.mediaUserGestureAt <= 1000,
						runtimeObservesMedia: state?.runtimeObservesMedia ?? null,
						ready: state?.ready ?? null,
						media: [...document.querySelectorAll('video,audio')].slice(0, 8).map(node => ({
							volume: Number(node.volume.toFixed(3)), muted: node.muted,
							paused: node.paused, hasStream: !!node.srcObject,
							duration: String(node.duration),
						})),
						siteVolume: document.querySelector('.douyin-player-volume-number')
							?.textContent?.trim() ?? null,
					};
				},
			});
			return frames.map(frame => ({ frameId: frame.frameId, ...(frame.result ?? {}) }));
		} catch (error) {
			return [{ error: String(error).slice(0, 180) }];
		}
	}, tabId);
	out.steps[label] = {
		site: { href: site.href, title: site.title, mediaCount: site.mediaCount,
			media: site.media, nativeVolumeText: site.nativeVolumeText, bodySample: site.bodySample },
		...state,
		witnessCounts: { trustedInputs: (site.witness.trustedInputs ?? []).length,
			volumeChanges: (site.witness.volumeChanges ?? []).length },
		witnessTail: {
			volumeChanges: (site.witness.volumeChanges ?? []).slice(-24),
			trustedInputs: (site.witness.trustedInputs ?? []).slice(-8),
		},
		documents: site.witness.documents ?? [],
		intents,
		tabs,
		pageTargets,
		bootstrapFrames,
	};
	return out.steps[label];
};

	// A live card can open a SECOND tab. Reading the first /follow tab would then
	// report the badge of a tab nobody is watching, so prefer the ACTIVE tab and
	// keep the whole tab list as evidence.
	const identity = await worker.evaluate(async url => {
		const tabs = (await chrome.tabs.query({})).map(tab => ({
			id: tab.id, url: tab.url ?? null, active: tab.active,
			openerTabId: tab.openerTabId ?? null,
		}));
		const matching = tabs.filter(tab => (tab.url ?? '').startsWith(url.replace(/\/$/, '')));
		const chosen = matching.find(tab => tab.active) ?? matching[0];
		if (!chosen?.id) throw new Error('Follow tab not found');
		return { tabId: chosen.id, tabs, matchingCount: matching.length,
			chosenActive: chosen.active };
	}, FOLLOW);
	tabId = identity.tabId;
	out.steps.identity = identity;
	await capture('beforeClick');

	const markerCard = out.steps.liveCards.markers
		.map(marker => marker.chain.find(entry => entry.box.w > 60 && entry.box.h > 60 && entry.box.x > 200))
		.find(Boolean);
	const sameOriginRoom = out.steps.liveCards.liveAnchors.find(item => /\/follow\/live\/\d+/u.test(item.href));
	const crossOriginRoom = out.steps.liveCards.liveAnchors.find(item => /live\.douyin\.com\/\d+/u.test(item.href));
	const liveTab = out.steps.liveCards.liveTabs.find(item => item.box.w > 8);
	const navAnchor = out.steps.liveCards.liveAnchors.find(item => /live\.douyin/u.test(item.href));
	// Only a same-origin /follow/live/<id> link or an in-feed card is the reported route.
	// Anything that whole-navigates to live.douyin.com is explicitly marked as such.
	const target = sameOriginRoom ? { x: sameOriginRoom.box.x, y: sameOriginRoom.box.y,
		kind: 'same-origin /follow/live/<id> room link', href: sameOriginRoom.href }
		: markerCard ? { x: markerCard.box.x, y: markerCard.box.y,
			kind: 'in-feed live card', box: markerCard.box, cls: markerCard.cls }
			: crossOriginRoom ? { x: crossOriginRoom.box.x, y: crossOriginRoom.box.y,
				kind: 'cross-origin live room link', href: crossOriginRoom.href, nonReportedRoute: true }
				: liveTab ? { x: liveTab.box.x, y: liveTab.box.y,
					kind: 'follow page live tab', nonReportedRoute: true }
					: navAnchor ? { x: navAnchor.box.x, y: navAnchor.box.y,
						kind: 'nav live link', href: navAnchor.href, nonReportedRoute: true }
						: null;
	out.steps.clickTarget = target;
	if (target) {
		out.steps.click = { ...target, ok: true };
		await page.mouse.click(target.x, target.y);
		await wait(9000);
	} else {
		out.steps.click = { ok: false, reason: 'no live card found' };
	}
	await capture('afterClick');
	// The first hop from /follow often lands on the live portal instead of a room.
	// Real-click the concrete "enter live room" link so a native volume slider exists.
	const roomLink = await page.evaluate(() => {
		const anchors = [...document.querySelectorAll('a[href]')]
			.filter(a => /live\.douyin\.com\/\d+|\/follow\/live\/\d+/u.test(a.href))
			.map(a => {
				const r = a.getBoundingClientRect();
				return { href: a.href, text: (a.textContent ?? '').trim().slice(0, 30),
					x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
					w: Math.round(r.width), h: Math.round(r.height) };
			})
			.filter(item => item.w > 8 && item.h > 8);
		return anchors[0] ?? null;
	});
	out.steps.roomLink = roomLink;
	if (roomLink) {
		await page.mouse.click(roomLink.x, roomLink.y);
		await wait(9000);
		out.steps.click2 = { ok: true, ...roomLink };
		await capture('afterRoomClick');
	} else {
		out.steps.click2 = { ok: false, reason: 'no concrete room link on the landing page' };
	}
	// Douyin opens a _blank live tab AND keeps the SPA route in the original tab.
	// The viewer and the toolbar badge belong to the ACTIVE tab; move both the
	// Puppeteer page and the sampled tabId there so the evidence matches reality.
	const activeTab = (out.steps.afterRoomClick?.tabs ?? out.steps.afterClick.tabs)
		.find(tab => tab.active);
	out.steps.activeTabAfterClick = activeTab ?? null;
	if (SAMPLE_TAB === 'spa') {
		out.steps.activeTabSwitch = {
			ok: false,
			skipped: true,
			reason: 'SPECTRA_SAMPLE_TAB=spa: stay on the same-origin /follow/live/<id> tab the viewer believes is a same-page navigation',
			sampledTabId: tabId,
			activeTabUrl: activeTab?.url ?? null,
		};
	} else if (activeTab?.id && activeTab.id !== tabId) {
		const candidate = browser.targets().find(target => target.type() === 'page'
			&& target.url() === activeTab.url);
		const switched = candidate ? await candidate.page() : null;
		if (switched) {
			page = switched;
			await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
			await installWitness(page);
			tabId = activeTab.id;
			out.steps.activeTabSwitch = { ok: true, from: identity.tabId, to: tabId,
				url: activeTab.url };
			// The new tab is active but Puppeteer's mouse still belongs to the old
			// target. Move focus AND the pointer into it so the site's hover-only
			// volume slider can expand in phase A (zero extension gestures).
			await page.bringToFront();
			await page.mouse.move(800, 600, { steps: 4 });
			await wait(6000);
		} else {
			out.steps.activeTabSwitch = { ok: false, reason: 'no Puppeteer page for the active tab' };
		}
	}
	const finalSite = out.steps.afterRoomClick?.site ?? out.steps.afterClick.site;
	const originOf = (value) => { try { return new URL(value).origin; } catch { return null; } };
	const followOrigin = originOf(out.steps.follow.href);
	const afterOrigin = originOf(finalSite.href);
	out.steps.route = {
		beforeHref: out.steps.beforeClick?.site?.href ?? null,
		afterFirstClickHref: out.steps.afterClick.site.href,
		afterHref: finalSite.href,
		afterPageUrl: page.url(),
		followOrigin,
		afterOrigin,
		originChanged: followOrigin && afterOrigin ? followOrigin !== afterOrigin : null,
		witnessDocuments: out.steps.afterClick.documents,
		sameDocumentByWitness: out.steps.afterClick.documents.length <= 1,
	};
	out.steps.afterSameDocument = out.steps.route.sameDocumentByWitness;

	const trackGeometry = () => page.evaluate(() => {
		const track = document.querySelector('.douyin-player-volume-slider-track');
		const thumb = document.querySelector('.douyin-player-volume-slider-thumb');
		const number = document.querySelector('.douyin-player-volume-number');
		const rect = track?.getBoundingClientRect();
		const thumbRect = thumb?.getBoundingClientRect();
		if (!rect || rect.height < 20) return null;
		return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y),
			h: Math.round(rect.height), thumbY: thumbRect ? Math.round(thumbRect.y) : null,
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

	const realDrag = async (ratio) => {
		const track = await revealAndTrack();
		if (!track) return { ok: false, reason: 'volume track did not expand' };
		const x = track.x;
		const fromY = track.thumbY ?? track.y + Math.round(track.h * 0.4);
		const toY = Math.round(track.y + track.h * (1 - Math.max(0, Math.min(1, ratio))));
		await page.mouse.move(x, fromY, { steps: 3 });
		await page.mouse.down();
		await page.mouse.move(x, toY, { steps: 14 });
		await wait(180);
		await page.mouse.up();
		await wait(1900);
		return { ok: true, x, fromY, toY, ratio, trackHeight: track.h, numberBefore: track.number };
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

	// The site's hover-only player controls only appear after a real focus
	// round-trip. Reproduce the popup phase's focus sequence WITHOUT clicking any
	// extension control, so phase A stays a zero-extension-gesture sample.
	const warmTab = await browser.newPage();
	await warmTab.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(error => {
		out.errors.push(`warm tab: ${String(error).slice(0, 120)}`);
	});
	await warmTab.close().catch(error => out.errors.push(`close warm tab: ${String(error).slice(0, 120)}`));
	await page.bringToFront();
	await page.mouse.move(800, 600, { steps: 4 });
	await wait(1500);
	out.steps.phaseAFocusWarmup = { ok: true,
		note: 'blank tab open/close + bringToFront + pointer move; no extension control intent' };

	out.steps.phaseA = await dragPhase('phaseA');

	try {
		popup = await browser.newPage();
		await popup.goto(`chrome-extension://${out.extensionId}/popup.html`,
			{ waitUntil: 'domcontentloaded', timeout: 30_000 });
		await wait(1200);
		out.steps.popupButtons = await popup.evaluate(() =>
			[...document.querySelectorAll('button,[role="button"],[class*="pause"],[class*="play"]')]
				.slice(0, 24).map(node => ({ cls: String(node.className ?? '').slice(0, 70),
					text: (node.textContent ?? '').trim().slice(0, 24) })));
		const button = await popup.$('.btn-pause, [class*="pause"], [class*="btn-play"]');
		if (button) { await button.click(); await wait(1200); }
		out.steps.popupGesture = { ok: !!button, kind: 'popup playback button click' };
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
		click: out.steps.click,
		beforeClickHref: out.steps.beforeClick.site.href,
		afterClickHref: out.steps.afterClick.site.href,
		afterSameDocument: out.steps.afterSameDocument,
		beforeClickBadge: out.steps.beforeClick.badgeText,
		afterClickBadge: out.steps.afterClick.badgeText,
		phaseA: { beforeBadge: out.steps.phaseA.before.badgeText,
			beforeUsage: out.steps.phaseA.before.badgeUsage, drags: summarise(out.steps.phaseA) },
		phaseB: { popupGesture: out.steps.popupGesture,
			beforeBadge: out.steps.phaseB.before.badgeText, drags: summarise(out.steps.phaseB) },
		phaseC: { beforeBadge: out.steps.phaseC.before.badgeText, drags: summarise(out.steps.phaseC) },
	};
	out.summary.intentTimeline = await worker.evaluate(() =>
		globalThis.__spectraFollowLiveIntentWitness?.intents ?? []);
	out.summary.intentWitnessErrors = await worker.evaluate(() =>
		globalThis.__spectraFollowLiveIntentWitness?.errors ?? []);

	const anyDragOk = (phase) => (phase?.drags ?? []).some(drag => drag.drag?.ok === true
		|| drag.dragOk === true);
	const loggedIn = out.steps.follow?.loginPrompt === false
		&& (out.steps.cookieInjection?.count ?? 0) > 0;
	const followRendered = /douyin\.com\/follow/u.test(out.steps.follow?.href ?? '')
		&& (out.steps.liveCards?.markers?.length ?? 0) > 0;
	const clicked = out.steps.click?.ok === true;
	const verdictSite = out.steps.afterRoomClick?.site ?? out.steps.afterClick.site;
	const playerPresent = (verdictSite?.mediaCount ?? 0) > 0
		|| verdictSite?.nativeVolumeText != null;
	const nonReportedRoute = out.steps.click?.nonReportedRoute === true;
	out.verdict = {
		tabCountBefore: out.steps.beforeClick?.tabs?.length ?? null,
		tabCountAfterRoomClick: (out.steps.afterRoomClick?.tabs ?? out.steps.afterClick?.tabs)?.length ?? null,
		newTabOpened: ((out.steps.afterRoomClick?.tabs ?? out.steps.afterClick?.tabs)?.length ?? 0)
			> (out.steps.beforeClick?.tabs?.length ?? 0),
		activeTabAfterClick: out.steps.activeTabAfterClick ?? null,
		activeTabSwitch: out.steps.activeTabSwitch ?? null,
		sampledTabId: tabId,
		sampledTabMode: SAMPLE_TAB,
		sampledTabUrl: page.url(),
		liveAnchorTargets: [...new Set((out.steps.liveCards?.liveAnchors ?? [])
			.map(item => item.target ?? '(same-tab default)'))],
		cookieInjection: out.steps.cookieInjection?.count ?? 0,
		loggedIn,
		followFeedRendered: followRendered,
		clicked,
		clickKind: out.steps.click?.kind ?? null,
		secondClick: out.steps.click2 ?? null,
		nonReportedRoute,
		originChanged: out.steps.route?.originChanged ?? null,
		playerPresent,
		phaseADragOk: anyDragOk(out.steps.phaseA),
		phaseBDragOk: anyDragOk(out.steps.phaseB),
		phaseCDragOk: anyDragOk(out.steps.phaseC),
		cookieSource: out.steps.cookieInjection?.source ?? null,
		cookieLoginNames: out.steps.cookieInjection?.loginNames ?? [],
		sampleValid: clicked && playerPresent && anyDragOk(out.steps.phaseA),
		reportedRouteExact: loggedIn && !nonReportedRoute
			&& out.steps.route?.originChanged === false,
		note: 'sampleValid only means a real live room was reached and the native slider was dragged. reportedRouteExact=false means this is NOT the logged-in same-origin /follow SPA route; do not quote its badge numbers as proof of that route.',
	};
	// Gated oracle: with ZERO extension gestures, every successful native drag
	// must create badge usage and keep badge and canonical snapshot on the site's
	// number. SPECTRA_ASSERT=1 turns this probe into a fail-loud regression gate.
	const phaseADrags = out.summary?.phaseA?.drags ?? [];
	out.verdict.phaseAZeroGestureSynchronized = phaseADrags.length > 0
		&& phaseADrags.every(drag => drag.dragOk === true && drag.usage === true
			&& drag.badgeMatchesSite === true && drag.snapshotMatchesSite === true);
} catch (error) {
	out.errors.push(String(error).slice(0, 500));
} finally {
	if (popup) await popup.close().catch(() => undefined);
	if (page) await page.close().catch(error => out.errors.push(`close page: ${String(error).slice(0, 160)}`));
	if (browser) await browser.close().catch(error => out.errors.push(`close browser: ${String(error).slice(0, 160)}`));
}

console.log(JSON.stringify(out, null, 2));
if (process.env.SPECTRA_ASSERT === '1') {
	if (out.verdict?.sampleValid !== true || out.verdict?.reportedRouteExact !== true
		|| out.verdict?.phaseAZeroGestureSynchronized !== true) {
		console.error('[SPECTRA_ASSERT] zero-extension-gesture native badge sync failed; '
			+ 'see verdict.sampleValid / reportedRouteExact / phaseAZeroGestureSynchronized');
		process.exitCode = 1;
	}
}
