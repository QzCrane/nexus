// goal: pin the Action Popup's settled bottom whitespace, with and without a
// background card, to the same value
// inv: the frame must follow the content's own height, never a stale prediction
import { expect } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { pausedMediaPage, TONE_PATH, toneResponse } from './helpers/media-fixture';
import {
	afterAllChrome,
	beforeAllChrome,
	testChrome,
} from './helpers/chrome-integration';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';
import { FRAME_MAX_HEIGHT_PX } from '../src/shared/popup-bootstrap';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
// `.glass-card` carries a 12px bottom margin and `#view-main` a 12px bottom
// padding, so the blank under the last card is the same 24px in every state.
const BOTTOM_WHITESPACE_PX = 24;

let browser: Browser;
let extensionId = '';
let controlPage: Page;
let server: ReturnType<typeof Bun.serve>;
let profileDir = '';
const mediaPages: Page[] = [];

async function visitLoadedMedia(page: Page): Promise<void> {
	await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('#media')?.readyState ?? 0) >= 1);
	await page.bringToFront();
	await controlPage.waitForFunction(async (url) => {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab?.id === undefined || tab.url !== url) return false;
		const facts = (await chrome.storage.session.get('spectra.media-facts.v1'))['spectra.media-facts.v1'];
		return facts?.[String(tab.id)]?.outcome === 'found' && (facts[String(tab.id)].usedAt ?? 0) > 0;
	}, { polling: 50, timeout: 10_000 }, page.url());
}

// The Popup reads durable media facts before its RPC completes. Establish both
// that input and the Background's announced shape, rather than sleeping and
// accidentally comparing a one-card first sample with a two-card second one.
async function waitForInventory(cards: number): Promise<void> {
	await controlPage.waitForFunction(async ({ count, origin }) => {
		const tabs = (await chrome.tabs.query({})).filter((tab) => tab.url?.startsWith(`${origin}/media/`));
		if (tabs.length !== count) return false;
		const response = await chrome.runtime.sendMessage({
			protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.tab.visible.list', payload: {},
		});
		const facts = (await chrome.storage.session.get('spectra.media-facts.v1'))['spectra.media-facts.v1'];
		if (!response?.ok || response.data.tabs.length !== count
			|| !tabs.every((tab) => tab.id !== undefined && response.data.tabs.includes(tab.id)
				&& facts?.[String(tab.id)]?.outcome === 'found')) return false;
		const active = tabs.find((tab) => tab.active);
		if (active?.id === undefined) return false;
		const popup = await chrome.action.getPopup({ tabId: active.id });
		return new URL(popup, location.href).searchParams.get('cards') === String(count);
	}, { polling: 100, timeout: 10_000 }, { count: cards, origin: `http://127.0.0.1:${server.port}` });
}

interface PopupGeometry {
	cards: number;
	bgCards: number;
	contentHeight: number;
	contentWidth: number;
	documentHeight: number;
	windowHeight: number;
	// The blank between the last card's bottom edge and the content box's bottom:
	// pure layout, independent of how tall the window happens to be.
	bottomWhitespace: number;
}

// What the user can actually reach: above Chrome's 600px ceiling the window
// cannot grow, so the document has to scroll. The overflow policy is one scroll
// surface for the whole Popup, which means the blank under the last card must
// still be exactly `BOTTOM_WHITESPACE_PX` once the document is scrolled down.
interface PopupOverflow {
	overflowY: string;
	scrollable: number;
	bottomWhitespaceAtEnd: number;
	rootScrollSurface: boolean;
	nestedScrollers: string[];
}

async function readGeometry(popup: Page): Promise<PopupGeometry> {
	return popup.evaluate(() => {
		const lastCard = [...document.querySelectorAll('#bg-stack .glass-card, #main-stage .glass-card')].pop();
		const container = document.querySelector('.view-container');
		if (!lastCard || !container) throw new Error('Popup geometry nodes are missing');
		const containerRect = container.getBoundingClientRect();
		return {
			cards: document.querySelectorAll('#bg-stack .glass-card, #main-stage .glass-card').length,
			bgCards: document.querySelectorAll('#bg-stack .glass-card').length,
			contentHeight: Math.round(containerRect.height * 100) / 100,
			contentWidth: Math.round(containerRect.width * 100) / 100,
			documentHeight: Math.round(document.documentElement.getBoundingClientRect().height * 100) / 100,
			windowHeight: window.innerHeight,
			bottomWhitespace: Math.round((containerRect.bottom - lastCard.getBoundingClientRect().bottom) * 100) / 100,
		};
	});
}

async function readOverflow(popup: Page): Promise<PopupOverflow> {
	return popup.evaluate(async () => {
		const html = document.documentElement;
		const lastCard = [...document.querySelectorAll('#bg-stack .glass-card, #main-stage .glass-card')].pop();
		if (!lastCard) throw new Error('Popup cards are missing');
		// `html` opts into smooth scrolling, so a measurement needs the settled
		// end position rather than a frame from the middle of a tween.
		html.style.scrollBehavior = 'auto';
		window.scrollTo(0, html.scrollHeight);
		await new Promise<void>((next) => requestAnimationFrame(() => next()));
		return {
			overflowY: getComputedStyle(html).overflowY,
			scrollable: Math.max(0, html.scrollHeight - html.clientHeight),
			rootScrollSurface: document.scrollingElement === html,
			nestedScrollers: [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && /^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)
					&& element.scrollHeight > element.clientHeight + 1;
			}).map((element) => element.id || element.className || element.tagName),
			bottomWhitespaceAtEnd:
				Math.round((html.clientHeight - lastCard.getBoundingClientRect().bottom) * 100) / 100,
		};
	});
}

// Live intrinsic geometry settles independently of asynchronous control reads.
async function settledGeometry(popup: Page): Promise<PopupGeometry> {
	let previous = await readGeometry(popup);
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		const current = await readGeometry(popup);
		if (Math.abs(current.documentHeight - Math.min(current.contentHeight, FRAME_MAX_HEIGHT_PX)) <= 1
			&& current.documentHeight === previous.documentHeight
			&& current.windowHeight === previous.windowHeight
			&& current.contentWidth === previous.contentWidth
			&& current.bottomWhitespace === previous.bottomWhitespace) return current;
		previous = current;
	}
	return previous;
}

async function openPopup(
	expectedCards: number,
): Promise<PopupGeometry & {
	overflow: PopupOverflow;
	reservedHeight: number | null;
	reservedSource: string | null;
}> {
	const knownTargets = new Set(browser.targets());
	const targetPromise = browser.waitForTarget(
		// The count travels in the URL, so the popup document is no longer at its
		// bare path.
		(target) => !knownTargets.has(target)
			&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`),
		{ timeout: 10_000 },
	);
	await controlPage.evaluate(async () => chrome.action.openPopup());
	const target: Target = await targetPromise;
	const popup = await target.asPage();
	if (!popup) throw new Error('The Action Popup did not expose a page');
	try {
		await popup.waitForFunction((count) => document.documentElement.dataset.spectraReady === 'true' && (
			document.querySelectorAll('#bg-stack .glass-card').length
				+ document.querySelectorAll('#main-stage .glass-card').length
		) === count, { timeout: 15_000 }, expectedCards);
		const geometry = await settledGeometry(popup);
		// Historical reservations have retired. Every open, including a reopen,
		// must derive its frame from all prepainted slots' intrinsic geometry.
		const reservation = await popup.evaluate(() => ({
			height: document.documentElement.dataset.spectraFrameReserved ?? null,
			source: document.documentElement.dataset.spectraFrameSource ?? null,
		})).catch(() => ({ height: null, source: null }));
		return {
			...geometry,
			overflow: await readOverflow(popup),
			reservedHeight: reservation.height === null ? null : Number(reservation.height),
			reservedSource: reservation.source,
		};
	} finally {
		if (!popup.isClosed()) {
			await popup.evaluate(() => window.close()).catch(() => undefined);
			const deadline = Date.now() + 2_000;
			while (Date.now() < deadline && !popup.isClosed()) {
				await new Promise((resolveWait) => setTimeout(resolveWait, 25));
			}
			if (!popup.isClosed()) await popup.close().catch(() => undefined);
		}
	}
}

async function setVisualizer(enabled: boolean): Promise<void> {
	await controlPage.evaluate(async (visualizerEnabled) => {
		const current = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.get', payload: {} });
		if (!current?.ok) throw new Error('Unable to read visualizer geometry settings');
		const response = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.patch', payload: { expectedRevision: current.data.revision,
				patch: { scope: 'global', changes: { visualizerEnabled } } } });
		if (!response?.ok) throw new Error('Unable to update visualizer geometry settings');
	}, enabled);
}

beforeAllChrome(async () => {
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === TONE_PATH) return toneResponse();
			const slug = url.pathname.slice('/media/'.length);
			if (url.pathname.startsWith('/media/') && ['alpha', 'beta', 'gamma'].includes(slug)) {
				return pausedMediaPage(`Paused Media ${slug}`);
			}
			return new Response('Not found', { status: 404 });
		},
	});
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-frame-geometry-'));
	browser = await launchPuppeteerBrowser({
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--autoplay-policy=no-user-gesture-required',
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
	}, {
		owner: 'apps/extension-spectra/test/popup-frame-geometry-chrome.spec.ts',
		profile: { kind: 'temporary', prefix: 'spectra-frame-geometry-' },
	});
	const workerTarget: Target = await browser.waitForTarget(
		(target) => target.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(workerTarget.url()).host;
	controlPage = await browser.newPage();
	await controlPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
	// Geometry is independent of pause expiry. Register real visits below and
	// keep those paused media eligible throughout this isolated profile's suite.
	await controlPage.evaluate(async () => {
		const current = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.get', payload: {} });
		if (!current?.ok) throw new Error('Unable to read geometry profile settings');
		const updated = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.patch', payload: { expectedRevision: current.data.revision,
				patch: { scope: 'global', changes: { pauseRetentionSeconds: 0 } } } });
		if (!updated?.ok) throw new Error('Unable to retain visited geometry fixtures');
	});
	for (const slug of ['alpha', 'beta']) {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.port}/media/${slug}`, { waitUntil: 'domcontentloaded' });
		await visitLoadedMedia(page);
		mediaPages.push(page);
	}
	await waitForInventory(2);
	for (const page of await browser.pages()) {
		if (page.url() === 'about:blank' || page.url() === '') await page.close().catch(() => undefined);
	}
}, 90_000);

afterAllChrome(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) await rm(profileDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
	server?.stop(true);
});

testChrome('reopens at stable intrinsic height without any historical reservation', async () => {
	const first = await openPopup(2);
	expect(first.reservedHeight).toBeNull();
	expect(first.reservedSource).toBeNull();
	expect(Math.abs(first.documentHeight - Math.min(first.contentHeight, FRAME_MAX_HEIGHT_PX))).toBeLessThanOrEqual(1);
	const second = await openPopup(2);
	expect(second.reservedHeight).toBeNull();
	expect(second.reservedSource).toBeNull();
	expect(Math.abs(second.documentHeight - Math.min(second.contentHeight, FRAME_MAX_HEIGHT_PX))).toBeLessThanOrEqual(1);
	expect(Math.abs(second.documentHeight - first.documentHeight)).toBeLessThanOrEqual(1);
}, 90_000);

testChrome('keeps the same bottom whitespace with and without a background card, scrolling as one document past the ceiling', async () => {
	const withBackground = await openPopup(2);
	expect(withBackground).toMatchObject({ cards: 2, bgCards: 1, bottomWhitespace: BOTTOM_WHITESPACE_PX });
	// The frame is written in whole pixels, so compare against the content with a
	// one-pixel tolerance rather than for exact equality.
	expect(Math.abs(withBackground.documentHeight - Math.min(withBackground.contentHeight, FRAME_MAX_HEIGHT_PX)))
		.toBeLessThanOrEqual(1);
	// This open is the overflow case by construction: one main card plus one
	// background card is taller than the 600px Chrome grants. The policy above
	// that ceiling is one scroll surface for the whole Popup, so the blank under
	// the last card is not lost - it is the same 24px, one scroll away. A nested
	// scroll area for the background list would end this gesture on the list's
	// own boundary instead, with the card clipped there.
	expect(withBackground.contentHeight).toBeGreaterThan(FRAME_MAX_HEIGHT_PX);
	expect(withBackground.overflow).toMatchObject({ overflowY: 'auto' });
	expect(withBackground.overflow).toMatchObject({ rootScrollSurface: true, nestedScrollers: [] });
	expect(withBackground.overflow.scrollable).toBeGreaterThan(0);
	expect(Math.abs(withBackground.overflow.bottomWhitespaceAtEnd - BOTTOM_WHITESPACE_PX))
		.toBeLessThanOrEqual(1);

	// Closing the background tab changes the shape of the content: the frame has
	// to shrink with it, instead of keeping the height the taller open reserved.
	await mediaPages[1]?.close().catch(() => undefined);
	await mediaPages[0]?.bringToFront();
	await waitForInventory(1);
	// Old installations may retain poisoned 600px height hints. These literal
	// retired keys are negative inputs, never a new cache API or layout owner.
	const seeded = await controlPage.evaluate((keys) => {
		for (const key of keys) localStorage.setItem(key, '600');
		return keys.map((key) => localStorage.getItem(key));
	}, ['spectra.popup.frame.1', 'spectra.popup.frameHeight', 'spectra.popup.frame.last']);
	expect(seeded).toEqual(['600', '600', '600']);
	const withoutBackground = await openPopup(1);

	expect(withoutBackground).toMatchObject({ cards: 1, bgCards: 0, bottomWhitespace: BOTTOM_WHITESPACE_PX });
	expect(withoutBackground.reservedHeight).toBeNull();
	expect(withoutBackground.reservedSource).toBeNull();
	// The regression this pins: a short open used to keep the taller frame, which
	// left ~250px of blank under its only card.
	expect(Math.abs(withoutBackground.documentHeight - withoutBackground.contentHeight))
		.toBeLessThanOrEqual(1);
	expect(Math.abs(withoutBackground.windowHeight - withoutBackground.documentHeight)).toBeLessThanOrEqual(1);
	expect(withoutBackground.bottomWhitespace).toBe(withBackground.bottomWhitespace);
	expect(withoutBackground.contentHeight).toBeLessThan(withBackground.contentHeight);
	// The complement: when the content fits, nothing is hidden and nothing can
	// scroll, so the same 24px is on screen instead of one scroll away.
	expect(withoutBackground.contentHeight).toBeLessThan(FRAME_MAX_HEIGHT_PX);
	expect(withoutBackground.overflow).toMatchObject({ overflowY: 'hidden', scrollable: 0 });
	expect(withoutBackground.overflow).toMatchObject({ rootScrollSurface: true, nestedScrollers: [] });
	expect(Math.abs(withoutBackground.overflow.bottomWhitespaceAtEnd - BOTTOM_WHITESPACE_PX))
		.toBeLessThanOrEqual(1);
	// Scrolling as a whole document must not cost width: the frame keeps the
	// Action Popup's own 390px in both states, so the cards do not reflow
	// between an open with background cards and one without.
	expect(withoutBackground.contentWidth).toBe(withBackground.contentWidth);
}, 90_000);

testChrome('switches one and two card shapes using their current content rather than stored heights', async () => {
	await waitForInventory(1);
	const one = await openPopup(1);
	expect(one.cards).toBe(1);
	expect(one.reservedSource).toBeNull();
	expect(one.reservedHeight).toBeNull();
	expect(Math.abs(one.contentHeight - one.documentHeight)).toBeLessThanOrEqual(1);

	// Adding a background card changes the intrinsic shape on this very open.
	const beta = await browser.newPage();
	await beta.goto(`http://127.0.0.1:${server.port}/media/beta`, { waitUntil: 'domcontentloaded' });
	await visitLoadedMedia(beta);
	await mediaPages[0]?.bringToFront();
	await waitForInventory(2);
	const two = await openPopup(2);
	expect(two.cards).toBe(2);
	expect(two.reservedSource).toBeNull();
	expect(two.reservedHeight).toBeNull();
	expect(Math.abs(Math.min(two.contentHeight, FRAME_MAX_HEIGHT_PX) - two.documentHeight)).toBeLessThanOrEqual(1);

	// Returning to one card must immediately discard the taller shape.
	await beta.close().catch(() => undefined);
	await mediaPages[0]?.bringToFront();
	await waitForInventory(1);
	const short = await openPopup(1);
	expect(short.cards).toBe(1);
	expect(short.reservedSource).toBeNull();
	expect(short.reservedHeight).toBeNull();
	expect(Math.abs(short.contentHeight - short.documentHeight)).toBeLessThanOrEqual(1);
	expect(Math.abs(short.documentHeight - one.documentHeight)).toBeLessThanOrEqual(1);
}, 90_000);

testChrome('uses current visualizer visibility for intrinsic height on the first and repeated open', async () => {
	await waitForInventory(1);
	await setVisualizer(true);
	const visible = await openPopup(1);
	try {
		await setVisualizer(false);
		const hidden = await openPopup(1);
		const repeated = await openPopup(1);
		expect(hidden.contentHeight).toBeLessThan(visible.contentHeight);
		for (const geometry of [visible, hidden, repeated]) {
			expect(geometry.reservedSource).toBeNull();
			expect(geometry.reservedHeight).toBeNull();
			expect(Math.abs(geometry.documentHeight - Math.min(geometry.contentHeight, FRAME_MAX_HEIGHT_PX))).toBeLessThanOrEqual(1);
			expect(geometry.bottomWhitespace).toBe(BOTTOM_WHITESPACE_PX);
			expect(geometry.overflow).toMatchObject({ rootScrollSurface: true, nestedScrollers: [] });
		}
		expect(Math.abs(repeated.documentHeight - hidden.documentHeight)).toBeLessThanOrEqual(1);
	} finally { await setVisualizer(true); }
}, 90_000);

testChrome('opens three cards and changes views without ResizeObserver delivery errors', async () => {
	const extraPages: Page[] = [];
	const errors: string[] = [];
	const popupDocument = await browser.newPage();
	// Install before navigation so startup errors cannot fall between target
	// creation and attaching the Action Popup's Page listener.
	popupDocument.on('pageerror', (error) => { errors.push(String(error)); });
	try {
		for (const slug of ['beta', 'gamma']) {
			const page = await browser.newPage();
			extraPages.push(page);
			await page.goto(`http://127.0.0.1:${server.port}/media/${slug}`, { waitUntil: 'domcontentloaded' });
			await visitLoadedMedia(page);
		}
		await mediaPages[0]?.bringToFront();
		await waitForInventory(3);
		await popupDocument.goto(`chrome-extension://${extensionId}/popup.html?cards=3`, { waitUntil: 'load' });
		await popupDocument.bringToFront();
		await popupDocument.waitForFunction(() => document.querySelectorAll('.glass-card').length === 3, { timeout: 8_000 }).catch(async (error) => {
			throw new Error(`Three-card fixture did not render: ${JSON.stringify(await popupDocument.evaluate(() => ({
				cards: [...document.querySelectorAll('.glass-card')].map((card) => ({ id: (card as HTMLElement).dataset.tabId, title: card.querySelector('.tab-title')?.textContent })),
				ready: document.documentElement.dataset.spectraReady,
				text: document.body.textContent?.slice(0, 1500),
			})))}`, { cause: error });
		});
		await settledGeometry(popupDocument);
		for (let round = 0; round < 2; round += 1) {
			await popupDocument.click('#btn-settings');
			await popupDocument.waitForFunction(() => document.querySelector('#view-settings')?.classList.contains('active'));
			await popupDocument.click('#btn-back');
			await popupDocument.waitForFunction(() => document.querySelector('#view-main')?.classList.contains('active'));
			await settledGeometry(popupDocument);
		}
		expect(errors).toEqual([]);
		await popupDocument.close();
		await mediaPages[0]?.bringToFront();
		await waitForInventory(3);
		const three = await openPopup(3);
		expect(three).toMatchObject({ cards: 3, bgCards: 2, bottomWhitespace: BOTTOM_WHITESPACE_PX });
		expect(three.documentHeight).toBe(FRAME_MAX_HEIGHT_PX);
		expect(three.contentWidth).toBe(390);
	} finally {
		if (!popupDocument.isClosed()) await popupDocument.close();
		for (const page of extraPages) await page.close();
	}
}, 45_000);
