// goal: verify /follow -> same-document live room -> native volume -> Action Popup ACK
// inv: isolated temporary profile, trusted input, read-only witnesses; no personal profile access
// usage: NEXUS_CHROME_EXECUTABLE="..." bun scripts/probe-douyin-follow-live-badge.mjs
// SPECTRA_LOGIN_WAIT_MS opts into headful manual login; never automate login or CAPTCHA.
// output: JSON on stdout; missing evidence or diagnostic-only modes exit 1
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';

const CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim()
	|| 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FOLLOW = 'https://www.douyin.com/follow';
const LOGIN_WAIT_MS = Number(process.env.SPECTRA_LOGIN_WAIT_MS ?? 0);
const HEADLESS = LOGIN_WAIT_MS > 0 ? false : process.env.SPECTRA_PROBE_HEADED === '0';
// Explicit active-tab sampling and the old pause/reload path are diagnostics only.
const SAMPLE_TAB = process.env.SPECTRA_SAMPLE_TAB === 'active' ? 'active' : 'spa';
const POPUP_ACK = process.env.SPECTRA_POPUP_ACK !== '0';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const distFiles = ['manifest.json', 'background.js', 'offscreen.js', 'content-runtime.js',
	'content-bootstrap.js', 'content-page-media-bridge.js', 'popup.js', 'popup.html', 'popup.css'];
const hashes = {};

const out = {
	capturedAt: new Date().toISOString(),
	kind: 'douyin-follow-live-native-badge-sync-proof',
	chrome: CHROME,
	chromeVersion: null,
	headless: HEADLESS,
	follow: FOLLOW,
	viewport: { width: 1600, height: 1200 },
	method: 'Fresh isolated profile; optional manual login; existing dist loaded through CDP. Native trusted drags precede the first Action Popup volume input. Active-tab and pause/reload modes are diagnostic-only.',
	artifact: { path: 'apps/extension-spectra/dist', sha256: hashes },
	steps: {},
	errors: [],
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const routeUrl = value => {
	try {
		const url = new URL(value);
		if (url.protocol === 'chrome-extension:') return `${url.protocol}//${url.host}${url.pathname}`;
		const known = url.origin === 'https://www.douyin.com' && /^\/follow(?:\/live\/\d+)?\/?$/u.test(url.pathname)
			|| url.origin === 'https://live.douyin.com' && /^\/\d+\/?$/u.test(url.pathname);
		return known ? `${url.origin}${url.pathname}` : '<other-page>';
	} catch { return '<unknown-page>'; }
};
let profile;
let browser;
let launchStarted = false;
let worker;
let page;
let tabId;
let popup;

try {
	if (!Number.isSafeInteger(LOGIN_WAIT_MS) || LOGIN_WAIT_MS < 0 || LOGIN_WAIT_MS > 600_000) {
		throw new Error('SPECTRA_LOGIN_WAIT_MS must be an integer between 0 and 600000');
	}
	for (const file of distFiles) {
		hashes[file] = createHash('sha256').update(await readFile(join(DIST, file))).digest('hex');
	}
	profile = await mkdtemp(join(tmpdir(), 'spectra-follow-live-'));
	out.steps.profilePrepared = { mode: 'temporary isolated profile', loginWaitMs: LOGIN_WAIT_MS };
	launchStarted = true;
	browser = await launchPuppeteerBrowser({
		executablePath: CHROME,
		headless: HEADLESS,
		enableExtensions: true,
		userDataDir: profile,
		args: ['--force-device-scale-factor=1', '--window-size=1600,1200'],
	}, {
		owner: 'apps/extension-spectra/scripts/probe-douyin-follow-live-badge.mjs',
		profile: { kind: 'temporary', prefix: 'spectra-follow-live-', isolated: true },
	});
	out.chromeVersion = await browser.version();
	const installer = await browser.target().createCDPSession();
	await installer.send('Extensions.loadUnpacked', { path: DIST.replace(/\\/g, '/') });
	await installer.detach().catch(error => out.errors.push(`detach installer: ${String(error)}`));
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
	// intents the background receives, including each observation stamp. It
	// never calls sendResponse and returns undefined, so it cannot alter the
	// product's own RPC handling.
	await worker.evaluate(() => {
		const state = { intents: [], ports: [], errors: [], sequence: 0 };
		const append = (list, entry) => {
			list.push({ sequence: ++state.sequence, at: Date.now(), ...entry });
			if (list.length > 240) list.splice(0, list.length - 240);
		};
		const failed = (boundary, error) => append(state.errors, {
			boundary, message: String(error), stack: error?.stack ?? null,
		});
		globalThis.__spectraFollowLiveIntentWitness = state;
		chrome.runtime.onConnect.addListener(port => {
			if (port.name !== 'spectra-popup-control') return;
			const connection = ++state.sequence;
			const senderIsPopup = port.sender?.id === chrome.runtime.id
				&& port.sender?.url?.startsWith(`chrome-extension://${chrome.runtime.id}/popup.html`);
			append(state.ports, { connection, type: 'connect', senderIsPopup });
			const onMessage = message => {
				try {
					append(state.ports, {
						connection, type: message?.type ?? null, sessionId: message?.sessionId ?? null,
						tabId: message?.tabId ?? null, documentId: message?.documentId ?? null,
						inputRevision: message?.inputRevision ?? null,
						throughRevision: message?.throughRevision ?? null,
						effectiveVolume: message?.effectiveVolume ?? null,
						presentationVolume: message?.presentationVolume ?? null,
						tone: message?.tone ?? null, groups: message?.groups ?? null,
					});
				} catch (error) { failed('popup-port-message', error); }
			};
			const onDisconnect = () => {
				try {
					const error = chrome.runtime.lastError?.message ?? null;
					append(state.ports, { connection, type: 'disconnect', error });
					if (error) failed('popup-port-disconnect', error);
				} catch (error) { failed('popup-port-disconnect-witness', error); }
				port.onMessage.removeListener(onMessage);
				port.onDisconnect.removeListener(onDisconnect);
			};
			port.onMessage.addListener(onMessage);
			port.onDisconnect.addListener(onDisconnect);
		});
		chrome.runtime.onMessage.addListener((message) => {
			try {
				if (!String(message?.type ?? '').includes('control.')) return;
				const payload = message.payload ?? {};
				state.intents.push({
					at: Date.now(),
					type: message.type,
					source: payload.source ?? null,
					userGesture: payload.userGesture ?? null,
					volumeBase: payload.patch?.volumeBase ?? null,
					mediaMuted: payload.patch?.mediaMuted ?? null,
					mediaId: payload.target?.mediaId ?? null,
					targetDocumentId: payload.target?.documentId ?? null,
					observationDocumentId: payload.observationDocumentId ?? null,
					mediaObservation: payload.mediaObservation ?? null,
					requestedCoverage: payload.requestedCoverage ?? null,
					baseRevision: payload.baseRevision ?? null,
					mutations: payload.mutations ?? null,
				});
				if (state.intents.length > 240) state.intents.splice(0, state.intents.length - 240);
			} catch (error) {
				failed('runtime-onMessage', error);
			}
		});
	});
	// Service-worker exceptions are the authoritative place to observe a thrown
	// "Control ACK belongs to an older media selection": the Popup only sees the
	// RPC failure that follows. Read-only CDP listener, never injected into the
	// product runtime.
	out.steps.workerExceptions = [];
	const workerSession = await workerTarget.createCDPSession();
	await workerSession.send('Runtime.enable');
	workerSession.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
		const text = [exceptionDetails?.text, exceptionDetails?.exception?.description]
			.filter(Boolean).join(' | ');
		out.steps.workerExceptions.push({ text, stackTrace: exceptionDetails?.stackTrace ?? null });
		if (out.steps.workerExceptions.length > 80) out.steps.workerExceptions.shift();
	});

	const installWitness = async (targetPage) => {
		const observe = () => {
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
		const recordDocument = () => {
			const state = read();
			state.documents = (state.documents ?? [])
				.concat([{ at: Date.now(), followRoute: /^\/follow(?:\/live\/\d+)?\/?$/u.test(location.pathname) }]).slice(-8);
			write(state);
		};
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recordDocument, { once: true });
		else recordDocument();
		};
		await targetPage.evaluateOnNewDocument(observe);
		await targetPage.evaluate(observe);
	};

	page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });

	await page.goto(FOLLOW, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	if (LOGIN_WAIT_MS > 0) {
		await page.bringToFront();
		console.error(`Manual login window: ${LOGIN_WAIT_MS} ms. Return to /follow; no automated login or CAPTCHA handling.`);
		await wait(LOGIN_WAIT_MS);
	}
	await wait(10_000);

	const readSite = () => page.evaluate(() => {
		const visible = node => {
			const rect = node.getBoundingClientRect();
			const style = getComputedStyle(node);
			return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
				&& rect.top < innerHeight && rect.left < innerWidth
				&& style.visibility !== 'hidden' && style.display !== 'none';
		};
		const promptNodes = [...document.querySelectorAll('[role="dialog"], [class*="login"], [class*="captcha"], [id*="captcha"]')]
			.filter(visible);
		const loginPrompt = promptNodes.some(node => /登录后即可关注|扫码登录|验证码登录|登录后查看/u.test(node.textContent ?? ''));
		const captcha = [...document.querySelectorAll('[class*="captcha"], [id*="captcha"], iframe[src*="captcha"]')]
			.some(visible) || promptNodes.some(node => /完成验证|安全验证|拖动滑块|请依次点击/u.test(node.textContent ?? ''));
		return {
			href: `${location.origin}${/^\/follow(?:\/live\/\d+)?\/?$/u.test(location.pathname) ? location.pathname : '/<other>'}`, 
			mediaCount: document.querySelectorAll('video,audio').length,
			media: [...document.querySelectorAll('video,audio')].slice(0, 8).map(node => ({
				volume: Number(node.volume.toFixed(3)), muted: node.muted, paused: node.paused,
				hasStream: !!node.srcObject, duration: String(node.duration),
			})),
			nativeVolumeText: document.querySelector('.douyin-player-volume-number')?.textContent?.trim() ?? null,
			loginPrompt,
			captcha,
			witness: (() => {
				try { return JSON.parse(sessionStorage.getItem('__spectraFollowLiveWitness') ?? '{}'); }
				catch (error) { return { errors: [String(error)] }; }
			})(),
			witnessErrors: (() => {
				try { return JSON.parse(sessionStorage.getItem('__spectraFollowLiveWitness.errors') ?? '[]'); }
				catch (error) { return [String(error)]; }
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
		const visible = element => {
			const r = element.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
				&& r.right > 0 && r.left < innerWidth && getComputedStyle(element).visibility !== 'hidden';
		};
		const markers = [...document.querySelectorAll('*')].filter(element =>
			!['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName)
			&& element.childElementCount === 0 && visible(element)
			&& /^(?:直播|直播中|正在直播|LIVE)$/iu.test((element.textContent ?? '').trim()));
		const withAncestors = markers.slice(0, 24).map(element => {
			let node = element;
			const chain = [];
			for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
				chain.push({ tag: node.tagName, cls: String(node.className ?? '').slice(0, 70),
					box: rect(node) });
			}
			return { kind: 'live-marker', chain };
		});
		const liveAnchors = [...document.querySelectorAll('a[href]')]
			.filter(a => visible(a) && /^https:\/\/(?:www\.douyin\.com\/follow\/live\/\d+|live\.douyin\.com\/(?:\d+)?)(?:[/?#]|$)/u.test(a.href))
			.map(a => ({ href: `${new URL(a.href).origin}${new URL(a.href).pathname}`,
				target: a.getAttribute('target'), box: rect(a) }))
			.filter(item => item.box.w > 8 && item.box.h > 8);
		const liveTabs = [...document.querySelectorAll('[class*="tab-live"], [class*="live-tab"]')]
			.filter(visible)
			.map(node => ({ cls: String(node.className ?? '').slice(0, 80), box: rect(node) }))
			.filter(item => item.box.w > 8 && item.box.h > 8);
		return { markers: withAncestors, liveAnchors, liveTabs };
	});

	out.steps.follow = await readSite();
	out.steps.liveCards = await findLiveCards();
	const followRendered = out.steps.follow.href === FOLLOW
		&& !out.steps.follow.loginPrompt && !out.steps.follow.captcha
		&& (out.steps.liveCards.liveAnchors.some(item => /\/follow\/live\/\d+/u.test(item.href))
			|| out.steps.liveCards.markers.some(marker => marker.chain.some(entry =>
				entry.box.w > 60 && entry.box.h > 60 && entry.box.x > 200)));
	out.steps.login = { state: followRendered ? 'visible-follow-feed-with-live-card' : 'unknown',
		loginPrompt: out.steps.follow.loginPrompt, captcha: out.steps.follow.captcha };
	if (!followRendered) {
		out.verdict = { status: 'blocked', loggedIn: 'unknown', reason: 'login/CAPTCHA or visible follow live-card prerequisite not satisfied' };
		throw new Error('Blocked: no eligible visible /follow live feed; manual login may be required');
	}
	await installWitness(page);

	const readState = () => worker.evaluate(async id => {
		const snapshotKey = `spectra.control.tab.${id}`;
		const usageKey = `spectra.badge.used.${id}`;
		const snapshot = (await chrome.storage.local.get(snapshotKey))[snapshotKey];
		const usage = (await chrome.storage.session.get(usageKey))[usageKey] === true;
		const fields = {};
		for (const [field, value] of Object.entries(snapshot?.fields ?? {})) {
			fields[field] = { actual: value?.actual ?? null, phase: value?.phase ?? null,
				revision: value?.revision ?? null, controlled: value?.controlled ?? null,
				mediaObservation: value?.mediaObservation ?? null,
				strategy: value?.strategy ?? null, lastError: value?.lastError ?? null };
		}
		let contentStatus = null;
		let contentError = null;
		try {
			contentStatus = await chrome.tabs.sendMessage(id, {
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id,
				type: 'spectra.content.runtime.status', payload: {},
			});
		} catch (error) { contentError = String(error); }
		if (contentStatus?.ok === false) contentError = contentStatus.error;
		const frame = await chrome.webNavigation.getFrame({ tabId: id, frameId: 0 });
		return {
			tabId: id,
			frame: frame ? { documentId: frame.documentId ?? null,
				href: `${new URL(frame.url).origin}${new URL(frame.url).pathname}` } : null,
			badgeText: await chrome.action.getBadgeText({ tabId: id }),
			badgeUsage: usage,
			snapshot: snapshot ? { tabId: snapshot.tabId, documentId: snapshot.documentId,
				generation: snapshot.generation, revision: snapshot.revision ?? null,
				mediaObservation: snapshot.mediaObservation ?? null,
				activeMedia: snapshot.activeMedia ?? null, live: snapshot.live ?? null, fields } : null,
			contentStatus: contentStatus?.ok ? { ready: contentStatus.data?.ready ?? null } : null,
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
	}).then(rows => rows.map(row => ({ ...row, url: routeUrl(row.url) })));

	const capture = async (label) => {
		const site = await readSite();
		const state = tabId === undefined ? {} : await readState();
		const intents = tabId === undefined ? [] : await worker.evaluate(() =>
			globalThis.__spectraFollowLiveIntentWitness?.intents?.slice(-16) ?? []);
		const tabs = await tabSnapshot();
		const pageTargets = browser.targets()
			.filter(target => target.type() === 'page').map(target => routeUrl(target.url()));
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
						followRoute: /^\/follow(?:\/live\/\d+)?\/?$/u.test(location.pathname),
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
			return [{ error: String(error.stack ?? error) }];
		}
	}, tabId);
	out.steps[label] = {
		site: { href: site.href, mediaCount: site.mediaCount, loginPrompt: site.loginPrompt,
			captcha: site.captcha, media: site.media, nativeVolumeText: site.nativeVolumeText },
		...state,
		witnessErrors: [...site.witnessErrors, ...(site.witness.errors ?? [])],
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
		const matching = tabs.filter(tab => {
			try { const candidate = new URL(tab.url); return `${candidate.origin}${candidate.pathname}` === url; }
			catch { return false; }
		});
		const chosen = matching[0];
		if (!chosen?.id || matching.length !== 1) throw new Error('Follow tab missing or ambiguous');
		return { tabId: chosen.id, tabs, matchingCount: matching.length,
			chosenActive: chosen.active };
	}, FOLLOW);
	tabId = identity.tabId;
	out.steps.identity = { ...identity, tabs: identity.tabs.map(tab => ({ ...tab, url: routeUrl(tab.url) })) };
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
	const roomLink = /^https:\/\/www\.douyin\.com\/follow\/live\/\d+\/?$/u.test(out.steps.afterClick.site.href)
		? null : await page.evaluate(() => {
		const anchors = [...document.querySelectorAll('a[href]')]
			.filter(a => /live\.douyin\.com\/\d+|\/follow\/live\/\d+/u.test(a.href))
			.map(a => {
				const r = a.getBoundingClientRect();
				return { href: `${new URL(a.href).origin}${new URL(a.href).pathname}`,
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
			&& routeUrl(target.url()) === activeTab.url);
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
	const readRoute = async () => {
		const site = await readSite();
		const state = await readState();
		const beforeDocumentId = out.steps.beforeClick.frame?.documentId;
		const afterDocumentId = state.frame?.documentId;
		const beforeUrl = new URL(out.steps.beforeClick.site.href);
		const afterUrl = new URL(site.href);
		const sameTab = tabId === identity.tabId && state.tabId === identity.tabId;
		const sameDocument = sameTab && typeof beforeDocumentId === 'string' && beforeDocumentId.length > 0
			&& typeof afterDocumentId === 'string' && afterDocumentId.length > 0
			&& beforeDocumentId === afterDocumentId;
		const exactPath = beforeUrl.origin === 'https://www.douyin.com' && beforeUrl.pathname === '/follow'
			&& afterUrl.origin === beforeUrl.origin && /^\/follow\/live\/\d+\/?$/u.test(afterUrl.pathname)
			&& state.frame?.href === site.href;
		return { beforeHref: beforeUrl.href, afterHref: site.href, sampledTabId: tabId,
			beforeDocumentId: beforeDocumentId ?? null, afterDocumentId: afterDocumentId ?? null,
			sameTab, sameDocument, exactPath, originChanged: beforeUrl.origin !== afterUrl.origin,
			reportedRouteExact: SAMPLE_TAB === 'spa' && sameDocument && exactPath,
			witnessDocuments: site.witness.documents ?? [] };
	};
	out.steps.route = await readRoute();
	out.steps.afterSameDocument = out.steps.route.sameDocument;
	out.steps.sampledSite = await readSite();
	if (out.steps.sampledSite.loginPrompt || out.steps.sampledSite.captcha || out.steps.sampledSite.mediaCount === 0) {
		out.verdict = { status: 'blocked', reason: 'login/CAPTCHA or live-player prerequisite not satisfied' };
		throw new Error('Blocked: sampled live player unavailable; no further gestures attempted');
	}

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
		const startedAt = Date.now();
		await page.mouse.move(x, fromY, { steps: 3 });
		await page.mouse.down();
		await page.mouse.move(x, toY, { steps: 14 });
		await wait(180);
		await page.mouse.up();
		await wait(1900);
		return { ok: true, startedAt, x, fromY, toY, ratio, trackHeight: track.h, numberBefore: track.number };
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
				trustedGesture: after.witnessTail.trustedInputs.some(event => event.trusted === true && event.at >= drag.startedAt),
			} });
		}
		return result;
	};

	// The full raw snapshot keeps the mediaObservation stamp. The product's
	// internal ordering guard compares that stamp against a control ACK, so a
	// sample that outranks an in-flight intent is the fact under investigation.
	const readControlState = () => worker.evaluate(async id => {
		const key = `spectra.control.tab.${id}`;
		const snapshot = (await chrome.storage.local.get(key))[key] ?? null;
		if (!snapshot) return null;
		return {
			tabId: snapshot.tabId ?? null,
			revision: snapshot.revision ?? null,
			generation: snapshot.generation ?? null,
			documentId: snapshot.documentId ?? null,
			activeMedia: snapshot.activeMedia ?? null,
			mediaObservation: snapshot.mediaObservation ?? null,
			volumeBase: snapshot.fields?.volumeBase ?? null,
			mediaMuted: snapshot.fields?.mediaMuted ?? null,
			boost: snapshot.fields?.boost ?? null,
			playing: snapshot.fields?.playing ?? null,
		};
	}, tabId);

	const probePopupAck = async () => {
		const result = { ok: false, requestedVolume: 70, errors: [], checks: {} };
		const readEvidence = async () => ({ control: await readControlState(), site: await readSite(),
			badge: await worker.evaluate(async id => chrome.action.getBadgeText({ tabId: id }), tabId) });
		const readUi = () => popup.evaluate(id => {
			const card = document.querySelector(`.glass-card[data-tab-id="${id}"]`);
			const slider = card?.querySelector('.vol-slider');
			const status = card?.querySelector('.control-sync-status');
			return { surface: document.documentElement.dataset.spectraSurface ?? null,
				coverage: card?.dataset.controlCoverage ?? null,
				syncI18n: status?.dataset.i18n ?? null, syncHidden: status?.hidden ?? null,
				sliderValue: slider ? Number(slider.value) : null, disabled: slider?.disabled ?? null,
				volumeText: card?.querySelector('.vol-number')?.textContent?.trim() ?? null,
				inputs: window.__spectraPopupWitness?.inputs ?? [],
				toasts: window.__spectraPopupWitness?.toasts ?? [],
				errors: window.__spectraPopupWitness?.errors ?? [] };
		}, tabId);
		try {
			await page.bringToFront();
			result.before = await readEvidence();
			if (result.before.site.loginPrompt || result.before.site.captcha) {
				out.verdict = { status: 'blocked', reason: 'login/CAPTCHA before first Action Popup input' };
				throw new Error('Blocked: login/CAPTCHA appeared before Action Popup');
			}
			result.startSequence = await worker.evaluate(() => globalThis.__spectraFollowLiveIntentWitness.sequence);
			const known = new Set(browser.targets());
			const session = await browser.target().createCDPSession();
			try {
				const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
				const tabs = targetInfos.filter(target => target.type === 'tab' && target.url === page.url());
				const active = await worker.evaluate(async id => (await chrome.tabs.get(id)).active, tabId);
				if (tabs.length !== 1 || !active) throw new Error('Sampled foreground tab target is missing or ambiguous');
				const pending = browser.waitForTarget(target => !known.has(target)
					&& target.url().startsWith(`chrome-extension://${out.extensionId}/popup.html`), { timeout: 20_000 })
					.then(target => ({ target }), error => ({ error }));
				await session.send('Extensions.triggerAction', { id: out.extensionId, targetId: tabs[0].targetId });
				const opened = await pending;
				if (opened.error) throw opened.error;
				popup = await opened.target.asPage();
				result.actionPopup = true;
			} finally { await session.detach(); }
			popup.on('pageerror', error => {
				result.errors.push(String(error.stack ?? error));
				if (result.errors.length > 80) result.errors.shift();
			});
			await popup.evaluate(id => {
				const witness = { inputs: [], toasts: [], errors: [] };
				window.__spectraPopupWitness = witness;
				const append = (list, item) => { list.push(item); if (list.length > 160) list.shift(); };
				const scan = () => {
					document.querySelectorAll('.preset-toast, [role="alert"]').forEach(node => {
						const text = (node.textContent ?? '').trim();
						if (text && !witness.toasts.includes(text)) append(witness.toasts, text);
					});
				};
				new MutationObserver(scan).observe(document.documentElement || document,
					{ childList: true, subtree: true, characterData: true, attributes: true });
				scan();
				window.addEventListener('error', event => append(witness.errors, String(event.error?.stack ?? event.message)));
				window.addEventListener('unhandledrejection', event => append(witness.errors, String(event.reason?.stack ?? event.reason)));
				for (const type of ['input', 'change']) document.addEventListener(type, event => {
					if (event.target?.matches(`.glass-card[data-tab-id="${id}"] .vol-slider`)) {
						append(witness.inputs, { at: Date.now(), type, trusted: event.isTrusted, value: Number(event.target.value) });
					}
				}, true);
			}, tabId);
			const selector = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
			await popup.waitForSelector(selector, { visible: true, timeout: 20_000 });
			result.sliderFound = true;
			await popup.waitForFunction(selector => {
				const slider = document.querySelector(selector);
				return slider && !slider.disabled && !slider.closest('[inert]')
					&& slider.closest('.glass-card')?.dataset.controlCoverage === 'known';
			}, { timeout: 20_000 }, selector);
			result.popupStatus = await readUi();
			result.beforeInput = await readEvidence();
			const geometry = await popup.$eval(selector, slider => ({
				value: Number(slider.value), min: Number(slider.min), max: Number(slider.max), step: Number(slider.step || 1),
			}));
			const delta = result.requestedVolume - geometry.value;
			const presses = Math.abs(delta / geometry.step);
			if (!(geometry.step > 0) || !Number.isInteger(presses) || presses < 1 || presses > 800
				|| result.requestedVolume < geometry.min || result.requestedVolume > geometry.max) {
				throw new Error('Slider cannot provide a new exact trusted keyboard input to 70');
			}
			result.inputStartSequence = await worker.evaluate(() => globalThis.__spectraFollowLiveIntentWitness.sequence);
			await popup.focus(selector);
			for (let index = 0; index < presses; index++) await popup.keyboard.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');
			result.input = { kind: 'trusted keyboard', from: geometry.value, to: 70, presses };
			for (let attempt = 0; attempt < 24; attempt++) {
				await wait(250);
				const state = await readControlState();
				if (state?.revision > result.beforeInput.control?.revision && state?.volumeBase?.actual === 70
					&& state.volumeBase.controlled === true && state.volumeBase.phase === 'applied') break;
			}
			await wait(600);
			result.afterPopup = await readUi();
			result.after = await readEvidence();
			const witness = await worker.evaluate(() => globalThis.__spectraFollowLiveIntentWitness);
			result.ports = witness.ports.filter(event => event.sequence > result.startSequence);
			result.intents = witness.intents.slice(-50);
			result.witnessErrors = witness.errors;
			result.workerExceptions = (out.steps.workerExceptions ?? []).slice();
			const before = result.beforeInput.control;
			const after = result.after.control;
			const stamp = before?.mediaObservation;
			const sameSelection = next => !!stamp && typeof stamp.owner === 'string' && stamp.owner.length > 0
				&& Number.isSafeInteger(stamp.epoch) && Number.isSafeInteger(stamp.selection)
				&& next?.owner === stamp.owner && next.epoch === stamp.epoch && next.selection === stamp.selection;
			const open = result.ports.find(event => event.type === 'open' && event.tabId === tabId
				&& event.documentId === before?.documentId);
			const connect = result.ports.find(event => event.type === 'connect' && event.connection === open?.connection);
			const stage = result.ports.findLast(event => event.type === 'stage' && event.connection === open?.connection
				&& event.sessionId === open?.sessionId && event.sequence > result.inputStartSequence
				&& event.effectiveVolume === 70 && Number.isSafeInteger(event.inputRevision) && event.inputRevision > 0);
			const flush = result.ports.find(event => event.type === 'flush' && event.connection === stage?.connection
				&& event.sessionId === stage?.sessionId && event.sequence > stage?.sequence
				&& event.throughRevision >= stage?.inputRevision);
			const volume = after?.volumeBase;
			const label = result.after.site.nativeVolumeText?.match(/^\s*(\d+(?:\.\d+)?)\s*%?\s*$/u);
			const siteVolume = label ? Number(label[1]) : null;
			const newRevision = Number.isSafeInteger(before?.revision) && Number.isSafeInteger(after?.revision)
				&& after.revision > before.revision && after.revision > result.before.control?.revision;
			result.checks = {
				actionPopup: result.actionPopup === true && result.popupStatus.surface === 'action-popup',
				trustedInputAndChange: ['input', 'change'].every(type => result.afterPopup.inputs
					.some(event => event.type === type && event.trusted === true && event.value === 70)),
				portStageAndFlush: connect?.senderIsPopup === true && !!open && !!stage && !!flush,
				identity: typeof before?.documentId === 'string' && before.documentId.length > 0
					&& before.tabId === tabId && after?.tabId === tabId && before.documentId === after.documentId
					&& before.documentId === out.steps.beforeClick.frame?.documentId
					&& before.documentId === result.before.control?.documentId
					&& Number.isSafeInteger(before.generation) && before.generation === after.generation
					&& before.generation === result.before.control?.generation && before.activeMedia != null
					&& ['documentId', 'frameId', 'mediaId', 'sourceRevision', 'kind'].every(key =>
						before.activeMedia[key] === after.activeMedia?.[key])
					&& sameSelection(after.mediaObservation) && sameSelection(volume?.mediaObservation)
					&& sameSelection(result.before.control?.mediaObservation),
				newAppliedAck: newRevision && Number.isSafeInteger(before?.volumeBase?.revision)
					&& Number.isSafeInteger(volume?.revision) && volume.revision > before.volumeBase.revision
					&& volume.controlled === true && volume.phase === 'applied' && volume.lastError === null
					&& typeof volume.intentId === 'string' && volume.intentId !== before.volumeBase.intentId
					&& volume.actual === 70 && before.volumeBase.actual !== 70,
				ui: result.afterPopup.coverage === 'known' && result.afterPopup.syncHidden === true
					&& result.afterPopup.sliderValue === 70 && result.afterPopup.disabled === false
					&& /^70\s*%?$/u.test(result.afterPopup.volumeText ?? ''),
				siteAndBadge: siteVolume !== null && Math.abs(siteVolume - 70) <= 2
					&& !result.after.site.loginPrompt && !result.after.site.captcha
					&& result.after.site.mediaCount <= 8 && result.after.site.media.some(media => !media.paused)
					&& result.after.site.media.filter(media => !media.paused)
						.every(media => !media.muted && Math.abs(media.volume * 100 - siteVolume) <= 2)
					&& /^\d+$/u.test(result.after.badge) && Math.abs(Number(result.after.badge) - siteVolume) <= 2,
				stillPlaying: before?.playing?.actual === true && after?.playing?.actual === true,
				noErrors: result.errors.length === 0 && witness.errors.length === 0 && result.workerExceptions.length === 0
					&& result.afterPopup.errors.length === 0 && result.afterPopup.toasts.length === 0
					&& !result.ports.some(event => event.type === 'disconnect')
					&& [after?.volumeBase, after?.mediaMuted, after?.boost, after?.playing]
						.every(field => field && field.lastError === null && field.phase !== 'error'),
			};
			result.ok = Object.values(result.checks).every(value => value === true);
		} catch (error) {
			result.errors.push(String(error.stack ?? error));
		} finally {
			try {
				const witness = await worker.evaluate(() => globalThis.__spectraFollowLiveIntentWitness);
				result.ports = witness.ports.filter(event => event.sequence > (result.startSequence ?? 0));
				result.intents = witness.intents.slice(-50);
				result.witnessErrors = witness.errors;
				result.workerExceptions = (out.steps.workerExceptions ?? []).slice();
				result.after ??= await readEvidence();
				if (popup) {
					result.closingPopup = await readUi();
					result.afterPopup ??= result.closingPopup;
				}
				if (witness.errors.length || result.workerExceptions.length
					|| result.closingPopup?.errors.length || result.closingPopup?.toasts.length
					|| result.closingPopup?.coverage !== 'known' || result.closingPopup?.sliderValue !== 70
					|| result.closingPopup?.syncHidden !== true
					|| result.ports.some(event => event.type === 'disconnect')) result.ok = false;
			} catch (error) { result.errors.push(`collect popup failure boundary: ${String(error.stack ?? error)}`); }
			if (popup) {
				try { await popup.close(); popup = null; }
				catch (error) { result.errors.push(`close action popup: ${String(error)}`); }
			}
		}
		result.ok = result.ok && result.errors.length === 0;
		return result;
	};

	if (!POPUP_ACK) {
		const warmTab = await browser.newPage();
		try { await warmTab.goto('about:blank', { waitUntil: 'domcontentloaded' }); }
		finally { await warmTab.close(); }
		out.steps.phaseAFocusWarmup = { ok: true, diagnosticOnly: true,
			note: 'historical blank-tab focus warmup, not repair evidence' };
	}
	await page.bringToFront();
	await page.mouse.move(800, 600, { steps: 4 });
	await wait(1500);

	out.steps.phaseA = await dragPhase('phaseA');
	out.steps.phaseAIntentWitness = await worker.evaluate(() => globalThis.__spectraFollowLiveIntentWitness);

	if (POPUP_ACK) {
		out.steps.popupAck = await probePopupAck();
	} else {
	try {
		popup = await browser.newPage();
		await popup.goto(`chrome-extension://${out.extensionId}/popup.html`,
			{ waitUntil: 'domcontentloaded', timeout: 30_000 });
		await wait(1200);
		out.steps.popupButtons = await popup.evaluate(() =>
			[...document.querySelectorAll('button,[role="button"],[class*="pause"],[class*="play"]')]
				.slice(0, 24).map(node => ({ cls: String(node.className ?? '').slice(0, 70) })));
		const button = await popup.$('.btn-pause, [class*="pause"], [class*="btn-play"]');
		if (button) { await button.click(); await wait(1200); }
		out.steps.popupGesture = { ok: !!button, kind: 'popup playback button click' };
		await popup.close().catch(error => out.errors.push(`close diagnostic popup: ${String(error)}`));
		popup = null;
	} catch (error) {
		out.steps.popupGesture = { ok: false, reason: String(error.stack ?? error) };
		if (popup) await popup.close().catch(error => out.errors.push(`close diagnostic popup: ${String(error)}`));
		popup = null;
	}
	await page.bringToFront();
	await wait(700);
	out.steps.phaseB = await dragPhase('phaseB');

	await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
	await wait(9000);
	out.steps.phaseC = await dragPhase('phaseC');
	}

	const num = (value) => {
		const match = typeof value === 'string' ? value.match(/^\s*(\d+(?:\.\d+)?)\s*%?\s*$/u) : null;
		return match ? Number(match[1]) : null;
	};
	const summarise = (phase) => phase.drags.map(({ ratio, drag, after }) => {
		const site = num(after.site);
		const volume = after.volumeBase?.actual ?? null;
		return { ratio, dragOk: drag.ok, dragReason: drag.reason ?? null, trustedGesture: after.trustedGesture,
			elementMatchesSite: typeof site === 'number' && typeof after.media?.volume === 'number'
				&& !after.media.muted && Math.abs(after.media.volume * 100 - site) <= 2,
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
		phaseB: out.steps.phaseB ? { popupGesture: out.steps.popupGesture,
			beforeBadge: out.steps.phaseB.before.badgeText, drags: summarise(out.steps.phaseB) } : null,
		phaseC: out.steps.phaseC ? { beforeBadge: out.steps.phaseC.before.badgeText,
			drags: summarise(out.steps.phaseC) } : null,
		popupAck: out.steps.popupAck ?? null,
	};
	out.summary.intentTimeline = await worker.evaluate(() =>
		globalThis.__spectraFollowLiveIntentWitness?.intents ?? []);
	out.summary.intentWitnessErrors = await worker.evaluate(() =>
		globalThis.__spectraFollowLiveIntentWitness?.errors ?? []);

	const anyDragOk = (phase) => (phase?.drags ?? []).some(drag => drag.drag?.ok === true
		|| drag.dragOk === true);
	out.steps.final = await capture('finalState');
	out.steps.finalRoute = await readRoute();
	const verdictSite = out.steps.final.site;
	const loggedIn = followRendered && verdictSite.loginPrompt === false && verdictSite.captcha === false
		? true : 'unknown';
	const clicked = out.steps.click?.ok === true;
	const playerPresent = (verdictSite?.mediaCount ?? 0) > 0
		|| verdictSite?.nativeVolumeText != null;
	const nonReportedRoute = out.steps.click?.nonReportedRoute === true;
	out.verdict = {
		status: out.verdict?.status === 'blocked' || loggedIn !== true ? 'blocked' : 'pending',
		tabCountBefore: out.steps.beforeClick?.tabs?.length ?? null,
		tabCountAfterRoomClick: (out.steps.afterRoomClick?.tabs ?? out.steps.afterClick?.tabs)?.length ?? null,
		newTabOpened: ((out.steps.afterRoomClick?.tabs ?? out.steps.afterClick?.tabs)?.length ?? 0)
			> (out.steps.beforeClick?.tabs?.length ?? 0),
		activeTabAfterClick: out.steps.activeTabAfterClick ?? null,
		activeTabSwitch: out.steps.activeTabSwitch ?? null,
		sampledTabId: tabId,
		sampledTabMode: SAMPLE_TAB,
		sampledTabUrl: routeUrl(page.url()),
		liveAnchorTargets: [...new Set((out.steps.liveCards?.liveAnchors ?? [])
			.map(item => item.target ?? '(same-tab default)'))],
		loggedIn,
		loginEvidence: out.steps.login,
		diagnosticOnly: !POPUP_ACK || SAMPLE_TAB !== 'spa',
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
		sampleValid: loggedIn === true && clicked && playerPresent && anyDragOk(out.steps.phaseA),
		reportedRouteExact: loggedIn === true && !nonReportedRoute && SAMPLE_TAB === 'spa'
			&& out.steps.route.reportedRouteExact === true && out.steps.finalRoute.reportedRouteExact === true,
		note: 'Login evidence is visible follow feed/live-card availability, not credential inspection. Only the original tab and nonempty matching Chrome document IDs on the exact /follow/live route qualify.',
	};
	// Missing evidence fails even without SPECTRA_ASSERT.
	const phaseADrags = out.summary?.phaseA?.drags ?? [];
	out.verdict.phaseAZeroGestureSynchronized = out.steps.phaseAIntentWitness.ports.length === 0
		&& !out.steps.phaseAIntentWitness.intents.some(intent => intent.source === 'popup')
		&& phaseADrags.length === 2
		&& new Set(phaseADrags.map(drag => drag.site)).size === 2
		&& phaseADrags.every(drag => drag.dragOk === true && drag.trustedGesture === true && drag.usage === true
			&& drag.elementMatchesSite === true && drag.badgeMatchesSite === true && drag.snapshotMatchesSite === true);
	const ack = out.steps.popupAck;
	out.verdict.popupControlStateAvailable = ack?.checks.ui === true && ack?.checks.stillPlaying === true;
	const owner = ack?.beforeInput?.control?.mediaObservation?.owner;
	const documentId = ack?.beforeInput?.control?.documentId;
	out.verdict.runtimeOwnsSelection = ack?.checks.identity === true && typeof owner === 'string'
		&& typeof documentId === 'string' && documentId.length > 0 && owner.startsWith(documentId);
	out.verdict.noStaleControlAck = ack?.checks.noErrors === true;
	const finalVolume = out.steps.final.snapshot?.fields?.volumeBase;
	const finalSiteVolume = num(verdictSite.nativeVolumeText);
	out.verdict.popupVolumeApplied = ack?.ok === true && ack?.checks.newAppliedAck === true
		&& ack?.checks.siteAndBadge === true && ack?.checks.portStageAndFlush === true
		&& finalVolume?.actual === 70 && finalVolume.controlled === true && finalVolume.phase === 'applied'
		&& finalVolume.lastError === null && finalSiteVolume !== null && Math.abs(finalSiteVolume - 70) <= 2
		&& /^\d+$/u.test(out.steps.final.badgeText) && Math.abs(Number(out.steps.final.badgeText) - 70) <= 2
		&& verdictSite.media.some(media => !media.paused && !media.muted && Math.abs(media.volume * 100 - 70) <= 2);
	const captures = Object.values(out.steps).filter(step => step && Array.isArray(step.bootstrapFrames));
	out.verdict.noObservationErrors = captures.every(step => !step.contentError && step.witnessErrors.length === 0
		&& step.bootstrapFrames.every(frame => !frame.error)
		&& Object.values(step.snapshot?.fields ?? {}).every(field => !field.lastError && field.phase !== 'error'))
		&& out.summary.intentWitnessErrors.length === 0 && out.steps.workerExceptions.length === 0;
} catch (error) {
	out.errors.push(String(error.stack ?? error));
} finally {
	let browserClosed = !launchStarted;
	if (browser) {
		try { await browser.close(); browserClosed = true; }
		catch (error) { out.errors.push(`close browser before profile cleanup: ${String(error)}`); }
	}
	if (profile && browserClosed) {
		try {
			await rm(profile, { recursive: true, force: true });
			out.steps.profileCleanup = { ok: true, scope: 'this invocation temporary profile only' };
		} catch (error) { out.errors.push(`remove owned temporary profile: ${String(error)}`); }
	} else if (profile) {
		out.steps.profileCleanup = { ok: false, reason: browser
			? 'browser close failed; owned profile retained' : 'launch returned no handle; cannot confirm browser closure, owned profile retained' };
	}
}

const baseOk = out.verdict?.sampleValid === true && out.verdict?.reportedRouteExact === true
	&& out.verdict?.phaseAZeroGestureSynchronized === true;
const popupOk = POPUP_ACK && out.steps.popupAck?.ok === true && out.verdict?.popupVolumeApplied === true
	&& out.verdict?.popupControlStateAvailable === true && out.verdict?.runtimeOwnsSelection === true
	&& out.verdict?.noStaleControlAck === true;
const passed = baseOk && popupOk && SAMPLE_TAB === 'spa' && out.verdict?.noObservationErrors === true
	&& out.errors.length === 0 && out.steps.profileCleanup?.ok === true;
out.verdict = { ...out.verdict, status: passed ? 'pass' : out.verdict?.status === 'blocked' ? 'blocked' : 'failed', passed };
console.log(JSON.stringify(out, null, 2));
if (!passed) {
	console.error('[SPECTRA] blocked, diagnostic-only, or incomplete/failed same-document native + Action Popup volume proof; see verdict and errors');
	process.exitCode = 1;
}
