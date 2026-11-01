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
import {
	FRAME_HEIGHT_KEY,
	frameHeightKeyForCards,
} from '../src/shared/popup-bootstrap';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
// Chrome grants an Action Popup at most 600px; past that the document scrolls.
const FRAME_MAX_HEIGHT_PX = 600;
// `.glass-card` carries a 12px bottom margin and `#view-main` a 12px bottom
// padding, so the blank under the last card is the same 24px in every state.
const BOTTOM_WHITESPACE_PX = 24;

let browser: Browser;
let extensionId = '';
let controlPage: Page;
let server: ReturnType<typeof Bun.serve>;
let profileDir = '';
const mediaPages: Page[] = [];

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
			bottomWhitespaceAtEnd:
				Math.round((html.clientHeight - lastCard.getBoundingClientRect().bottom) * 100) / 100,
		};
	});
}

// The frame animates to its target, so a single read can catch it mid-tween.
async function settledGeometry(popup: Page): Promise<PopupGeometry> {
	let previous = await readGeometry(popup);
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		const current = await readGeometry(popup);
		if (current.documentHeight === previous.documentHeight
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
		await popup.waitForFunction((count) => (
			document.querySelectorAll('#bg-stack .glass-card').length
				+ document.querySelectorAll('#main-stage .glass-card').length
		) >= count, { timeout: 15_000 }, expectedCards);
		const geometry = await settledGeometry(popup);
		// What the render-blocking head script reserved before the first paint,
		// and which recorded shape answered. The height is a promise about a card
		// count, so the source key is part of the assertion: this open must have
		// been sized by the shape it actually draws.
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

beforeAllChrome(async () => {
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === TONE_PATH) return toneResponse();
			const slug = url.pathname.slice('/media/'.length);
			if (url.pathname.startsWith('/media/') && ['alpha', 'beta'].includes(slug)) {
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
	for (const slug of ['alpha', 'beta']) {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${server.port}/media/${slug}`, { waitUntil: 'domcontentloaded' });
		mediaPages.push(page);
	}
	// Let each document's own media report reach Background before measuring.
	await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
	for (const page of await browser.pages()) {
		if (page.url() === 'about:blank' || page.url() === '') await page.close().catch(() => undefined);
	}
}, 90_000);

afterAllChrome(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) await rm(profileDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
	server?.stop(true);
});

testChrome('opens at the height it settles on, so the window never jumps', async () => {
	// A `type="module"` script is deferred, so reserving the frame from inside
	// the popup module always landed after the browser could already paint: the
	// window was shown at one height and then animated to another, on every
	// open. The reservation now happens in a render-blocking head script, so
	// the first frame the user sees is already the reserved one.
	const first = await openPopup(1);
	// The very first open has no hint to reserve, so it is the one open that is
	// allowed to grow into place.
	expect(first.reservedHeight).toBeNull();

	// Same content, second open: the hint is this content's settled height, so
	// the reserved frame and the settled frame must be the same height. Any
	// difference is a visible jump the user did not ask for.
	const second = await openPopup(1);
	expect(second.reservedHeight).not.toBeNull();
	expect(Math.abs((second.reservedHeight ?? 0) - second.documentHeight)).toBeLessThanOrEqual(1);
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
	expect(withBackground.overflow.scrollable).toBeGreaterThan(0);
	expect(Math.abs(withBackground.overflow.bottomWhitespaceAtEnd - BOTTOM_WHITESPACE_PX))
		.toBeLessThanOrEqual(1);

	// Closing the background tab changes the shape of the content: the frame has
	// to shrink with it, instead of keeping the height the taller open reserved.
	await mediaPages[1]?.close().catch(() => undefined);
	await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
	await mediaPages[0]?.bringToFront();
	// Seed the worst case: the last settled frame was the tallest one Chrome
	// allows, while this open's content is short. Nothing about this open can
	// change the container's size after the inventory publishes, so only a
	// retarget on the publish itself can bring the frame back down. Both the
	// shape's own entry and the legacy single hint are poisoned, because either
	// one would be enough to open this Popup at 600.
	const seeded = await controlPage.evaluate((keys) => {
		for (const key of keys) localStorage.setItem(key, '600');
		return keys.map((key) => localStorage.getItem(key));
	}, [frameHeightKeyForCards(1), FRAME_HEIGHT_KEY]);
	expect(seeded).toEqual(['600', '600']);
	const withoutBackground = await openPopup(1);

	expect(withoutBackground).toMatchObject({ cards: 1, bgCards: 0, bottomWhitespace: BOTTOM_WHITESPACE_PX });
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
	expect(Math.abs(withoutBackground.overflow.bottomWhitespaceAtEnd - BOTTOM_WHITESPACE_PX))
		.toBeLessThanOrEqual(1);
	// Scrolling as a whole document must not cost width: the frame keeps the
	// Action Popup's own 390px in both states, so the cards do not reflow
	// between an open with background cards and one without.
	expect(withoutBackground.contentWidth).toBe(withBackground.contentWidth);
}, 90_000);

testChrome('opens each shape at the height that shape settled on, so switching card counts does not resize the window', async () => {
	// The previous open left this one-card shape's real height recorded. From here
	// on, this shape must open already at that height - no growth, no correction.
	await new Promise((resolveWait) => setTimeout(resolveWait, 300));
	const one = await openPopup(1);
	expect(one.cards).toBe(1);
	expect(one.reservedSource).toBe(frameHeightKeyForCards(1));
	expect(one.reservedHeight).not.toBeNull();
	expect(Math.abs((one.reservedHeight ?? 0) - one.documentHeight)).toBeLessThanOrEqual(1);

	// A second media tab changes the shape. Its first open may learn the height it
	// keeps; what matters is that it is sized by its own count, not by whatever
	// the previous open happened to be.
	const beta = await browser.newPage();
	await beta.goto(`http://127.0.0.1:${server.port}/media/beta`, { waitUntil: 'domcontentloaded' });
	await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
	await mediaPages[0]?.bringToFront();
	// The announcement is two reads and a setPopup, none of which the focus event
	// waits for; a human takes far longer to reach the toolbar than this.
	await new Promise((resolveWait) => setTimeout(resolveWait, 600));
	const two = await openPopup(2);
	expect(two.cards).toBe(2);
	expect(two.reservedSource).toBe(frameHeightKeyForCards(2));
	expect(Math.abs((two.reservedHeight ?? 0) - two.documentHeight)).toBeLessThanOrEqual(1);

	// Back to one card. A single hint would still hold the two-card height here -
	// that is exactly the jump this pins away: the shape's own entry has to win
	// over the most recent one.
	await beta.close().catch(() => undefined);
	await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
	await mediaPages[0]?.bringToFront();
	const short = await openPopup(1);
	expect(short.cards).toBe(1);
	expect(short.reservedSource).toBe(frameHeightKeyForCards(1));
	expect(Math.abs((short.reservedHeight ?? 0) - short.documentHeight)).toBeLessThanOrEqual(1);
	expect(Math.abs(short.documentHeight - one.documentHeight)).toBeLessThanOrEqual(1);
}, 90_000);
