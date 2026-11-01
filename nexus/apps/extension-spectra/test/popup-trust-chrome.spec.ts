// goal: pin that the Action Popup the Background itself announced is a trusted sender
//
// `popup-frame` states the card count in the Popup's own URL (`popup.html?cards=N`),
// so the document the user opens is never at the bare path the manifest names.
// Every trust decision used to compare whole URLs against that bare path, which
// refused the Popup — and only when the count was known, i.e. on ordinary pages.
// The two symptoms were the Popup's control Port closing on connect
// ("Background control channel disconnected") and its discrete controls being
// refused ("Extension-invoked control requires a trusted Popup…").
//
// Both are asserted through the user-visible effect instead of the message: the
// Port carries staged controls (volume), the RPC carries discrete ones (speed).
import { expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { afterAllChrome, beforeAllChrome, testChrome } from './helpers/chrome-integration';
import { pausedMediaPage, TONE_PATH, toneResponse } from './helpers/media-fixture';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const MEDIA_PATH = '/media/one';
const TRUST_FAILURE_MARKERS = ['trusted Popup', 'control channel disconnected', 'forbidden'];

let browser: Browser;
let extensionId = '';
let controlPage: Page;
let mediaPage: Page;
let server: ReturnType<typeof Bun.serve>;
let profileDir = '';

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 12_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last = await read();
	while (!accept(last)) {
		if (Date.now() > deadline) return last;
		await new Promise((next) => setTimeout(next, 100));
		last = await read();
	}
	return last;
}

async function openActionPopup(): Promise<{ popup: Page; search: string }> {
	const known = new Set(browser.targets());
	const targetPromise = browser.waitForTarget(
		// The count travels in the URL, which is exactly why the Popup document is
		// not at its bare path.
		(candidate) => !known.has(candidate)
			&& candidate.url().startsWith(`chrome-extension://${extensionId}/popup.html`),
		{ timeout: 15_000 },
	);
	await controlPage.evaluate(async () => chrome.action.openPopup());
	const target: Target = await targetPromise;
	const popup = await target.asPage();
	if (!popup) throw new Error('The Action Popup did not expose a page');
	await popup.waitForSelector('#main-stage .glass-card', { timeout: 15_000 });
	// The card only accepts input once its own control snapshot has been applied;
	// a click before that is a click on a card that does not exist yet.
	await waitFor(
		() => popup.evaluate(() => (document.getElementById('main-stage')?.textContent ?? '').length),
		(length) => length > 0,
	);
	const search = await popup.evaluate(() => window.location.search);
	return { popup, search };
}

function readMedia(): Promise<{ volume: number; playbackRate: number }> {
	return mediaPage.evaluate(() => {
		const element = document.getElementById('media') as HTMLVideoElement | null;
		if (!element) throw new Error('The media fixture is missing');
		return { volume: element.volume, playbackRate: element.playbackRate };
	});
}

async function stageVolume(popup: Page, percent: number): Promise<void> {
	await popup.evaluate((value: number) => {
		const slider = document.querySelector('#main-stage .vol-slider') as HTMLInputElement | null;
		if (!slider) throw new Error('The volume slider is missing');
		slider.value = String(value);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	}, percent);
}

beforeAllChrome(async () => {
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === TONE_PATH) return toneResponse();
			if (url.pathname === MEDIA_PATH) return pausedMediaPage('Trust Probe');
			return new Response('Not found', { status: 404 });
		},
	});
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-popup-trust-'));
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
		owner: 'apps/extension-spectra/test/popup-trust-chrome.spec.ts',
		profile: { kind: 'temporary', prefix: 'spectra-popup-trust-' },
	});
	const worker: Target = await browser.waitForTarget(
		(candidate) => candidate.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(candidate.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(worker.url()).host;
	controlPage = await browser.newPage();
	await controlPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
	mediaPage = await browser.newPage();
	await mediaPage.goto(`http://127.0.0.1:${server.port}${MEDIA_PATH}`, { waitUntil: 'domcontentloaded' });
	await mediaPage.bringToFront();
	// Let the document's own media report reach Background before the Popup opens.
	await new Promise((next) => setTimeout(next, 2_000));
	for (const page of await browser.pages()) {
		if (page.url() === 'about:blank' || page.url() === '') await page.close().catch(() => undefined);
	}
	await mediaPage.bringToFront();
}, 90_000);

afterAllChrome(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) await rm(profileDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
	server?.stop(true);
});

testChrome('opens the Popup at the URL the Background announced, count included', async () => {
	const tabId = await controlPage.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		return tab?.id ?? null;
	});
	expect(tabId).not.toBeNull();
	const announced = await controlPage.evaluate(
		async (id: number) => chrome.action.getPopup({ tabId: id }),
		tabId as number,
	);
	// The precondition of the regression: the announced Popup is not the bare path.
	expect(announced).toContain('/popup.html?cards=');
});

testChrome('keeps the control Port alive, so a staged volume actually reaches the media', async () => {
	const { popup, search } = await openActionPopup();
	try {
		// The sender identity the Background sees is this document's URL.
		expect(search).toMatch(/^\?cards=\d+$/u);
		await stageVolume(popup, 40);
		const staged = await waitFor(readMedia, (value) => Math.abs(value.volume - 0.4) < 0.02);
		expect(staged.volume).toBeCloseTo(0.4, 1);

		const rendered = await popup.evaluate(() => document.body.textContent ?? '');
		for (const marker of TRUST_FAILURE_MARKERS) {
			expect(rendered.toLowerCase()).not.toContain(marker.toLowerCase());
		}
	} finally {
		await popup.close().catch(() => undefined);
	}
}, 60_000);

testChrome('authorizes a discrete Popup control instead of refusing its sender', async () => {
	const { popup } = await openActionPopup();
	try {
		const before = await readMedia();
		await popup.click('#main-stage .btn-speed[data-delta="0.1"]');
		const after = await waitFor(readMedia, (value) => Math.abs(value.playbackRate - 1.1) < 0.02);
		// A refusal leaves the media exactly where it was: the intent only reaches
		// the document when the Background accepts the Popup as its source.
		expect(after.playbackRate).toBeCloseTo(1.1, 1);
		expect(after.playbackRate).toBeGreaterThan(before.playbackRate);

		const rendered = await popup.evaluate(() => document.body.textContent ?? '');
		expect(rendered).not.toContain('trusted Popup');
	} finally {
		await popup.close().catch(() => undefined);
	}
}, 60_000);
