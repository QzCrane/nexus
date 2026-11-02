// goal: measure real Popup -> media-card first-paint latency under cold and warm service-worker states
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { pausedMediaPage, TONE_PATH, toneResponse } from './helpers/media-fixture';
import { describe, expect, test } from 'bun:test';
import { readMediaMembershipFromStorage } from '../src/popup/media-inventory-from-storage';
import { MEDIA_FACTS_KEY } from '../src/shared/media-card-policy';
import {
	afterAllChrome,
	beforeAllChrome,
	chromeIntegrationEnabled,
	testChrome,
} from './helpers/chrome-integration';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
if (chromeIntegrationEnabled && !existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}

let browser: Browser;
let extensionId = '';
let controlPage: Page;
let server: ReturnType<typeof Bun.serve>;
let profileDir = '';
const mediaPages: Page[] = [];
const mediaUrls: string[] = [];

describe('session media inventory forecast', () => {
	test('projects recent, expired and frozen media without a fixed quota or page probes', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const now = Date.now();
		const fact = (extra: Record<string, unknown>) => ({ schemaVersion: 2, documentId: 'document-known', outcome: 'found',
			at: now, source: 'report', reportRevision: 1, userInteracted: true, usedAt: now - 120_000, ...extra });
		const records: Record<string, unknown> = {
			1: fact({ playing: false, pausedAt: now - 1_000 }),
			2: fact({ playing: false, pausedAt: now - 120_000 }),
			3: fact({ playing: true, pausedAt: null, unavailableAt: now - 1_000 }),
			4: fact({ playing: true, pausedAt: null, unavailableAt: now - 120_000 }),
		};
		const tabs = [
			{ id: 1, url: 'https://media.example/1' }, { id: 2, url: 'https://media.example/2' },
			{ id: 3, url: 'https://media.example/3', frozen: true }, { id: 4, url: 'https://media.example/4', frozen: true },
			{ id: 5, url: 'https://media.example/5', status: 'unloaded' },
		] as chrome.tabs.Tab[];
		for (let id = 10; id < 22; id += 1) {
			tabs.push({ id, url: `https://media.example/${id}` } as chrome.tabs.Tab);
			records[String(id)] = fact({ playing: true, pausedAt: null });
		}
		let probes = 0;
		let localReads = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			storage: { session: { get: async () => ({ [MEDIA_FACTS_KEY]: records }) },
				local: { get: async () => { localReads += 1; throw new Error('local-forecast-is-retired'); } } },
			tabs: { sendMessage: async () => { probes += 1; throw new Error('must-not-probe'); } },
			scripting: { executeScript: async () => { probes += 1; throw new Error('must-not-inject'); } },
		} });
		try {
			const membership = await readMediaMembershipFromStorage(tabs, 60);
			expect(membership?.tabs).toEqual([1, 3, ...Array.from({ length: 12 }, (_, index) => index + 10)]);
			expect(membership?.inactiveTabs).toEqual([2, 4]);
			expect(membership?.nextExpiryAt).toBe(now + 59_000);
			expect(probes).toBe(0);
			expect(localReads).toBe(0);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('returns unavailable rather than reading local history when session forecast fails', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: {
			session: { get: async () => { throw new Error('session-unavailable'); } },
			local: { get: async () => { throw new Error('must-not-fallback'); } },
		} } });
		try { expect(await readMediaMembershipFromStorage([])).toBeNull(); }
		finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});

async function stopServiceWorker(): Promise<void> {
	// Natural MV3 idle stop: open/close the popup, then wait past the 30s idle
	// timeout. The CDP workerVersionUpdated events are unreliable in headless
	// extension runs, so the natural path is the deterministic one.
	const knownTargets = new Set(browser.targets());
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target)
			// The card count travels in the Popup's URL (`?cards=N`), so the
			// document is not at its bare path.
			&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`),
		{ timeout: 10_000 },
	);
	await controlPage.evaluate(async () => chrome.action.openPopup());
	const target = await targetPromise;
	const popup = await target.asPage();
	if (popup) await popup.evaluate(() => window.close()).catch(() => undefined);
	await new Promise((resolveWait) => setTimeout(resolveWait, 35_000));
}

async function measurePopupOpen(expectedCards: number, label: string, stopFirst: boolean): Promise<number> {
	if (stopFirst) await stopServiceWorker();
	const started = performance.now();
	const knownTargets = new Set(browser.targets());
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target)
			// The card count travels in the Popup's URL (`?cards=N`), so the
			// document is not at its bare path.
			&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`),
		{ timeout: 10_000 },
	);
	await controlPage.evaluate(async () => chrome.action.openPopup());
	const target = await targetPromise;
	const popup = await target.asPage();
	if (!popup) throw new Error('no popup page');
	const attached = performance.now();
	const errors: string[] = [];
	popup.on('pageerror', (error) => { errors.push(String(error)); });
	try {
		// Stage 1: the inventory evidence arrives (spectra.tab.visible.list round trip).
		await popup.waitForFunction(() => {
			const value = document.documentElement.dataset.mediaInventory;
			return value !== undefined && value !== '' && value !== 'unavailable';
		}, { timeout: 15_000 }).catch(async (error) => {
			const state = await popup.evaluate(() => ({ url: location.href, inventory: document.documentElement.dataset.mediaInventory,
				ready: document.documentElement.dataset.spectraReady, cards: document.querySelectorAll('.glass-card').length,
				text: document.body.textContent?.slice(0, 1_000) })).catch(() => null);
			throw new Error(`Popup inventory did not settle: ${JSON.stringify({ label, state, errors })}`, { cause: error });
		});
		const inventory = performance.now();
		// Stage 2: the media cards are rendered (main-stage for the active tab, bg-stack for the rest).
		await popup.waitForFunction((count) => {
			return document.querySelectorAll('#bg-stack .glass-card').length
				+ document.querySelectorAll('#main-stage .glass-card').length >= count;
		}, { timeout: 15_000 }, expectedCards);
		const cards = performance.now();
		const states = await popup.evaluate(() => ({
			mediaInventory: document.documentElement.dataset.mediaInventory ?? null,
			spectraReady: document.documentElement.dataset.spectraReady ?? null,
			bgCards: document.querySelectorAll('#bg-stack .glass-card').length,
			mainCards: document.querySelectorAll('#main-stage .glass-card').length,
		}));
		console.log(`[latency] ${label}: attach=${(attached - started).toFixed(1)}ms inventory=${(inventory - started).toFixed(1)}ms cards=${(cards - started).toFixed(1)}ms states=${JSON.stringify(states)}`);
		return cards - started;
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
			if (url.pathname.startsWith('/media/') && ['alpha', 'beta', 'gamma'].includes(slug)) {
				// A real source, not a player shell: fixture pages must model what the
				// inventory is allowed to call a media tab.
				return pausedMediaPage(`Paused Media ${slug}`);
			}
			return new Response('Not found', { status: 404 });
		},
	});
	mediaUrls.push(
		`http://127.0.0.1:${server.port}/media/alpha`,
		`http://127.0.0.1:${server.port}/media/beta`,
		`http://127.0.0.1:${server.port}/media/gamma`,
	);

	profileDir = await mkdtemp(join(tmpdir(), 'spectra-latency-'));
	browser = await launchPuppeteerBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
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
		owner: 'apps/extension-spectra/test/popup-inventory-latency.spec.ts',
		profile: { kind: 'temporary', prefix: 'spectra-latency-', isolated: true },
	});
	const workerTarget: Target = await browser.waitForTarget(
		(target) => target.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(workerTarget.url()).host;
	controlPage = await browser.newPage();
	await controlPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
	// This workload measures worker restart latency, not a pause deadline. Its
	// two natural-idle waits exceed the default retention; freeze/expiry rules
	// are covered independently by the pure session forecast cases above.
	await controlPage.evaluate(async () => {
		const current = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.get', payload: {} });
		if (!current?.ok) throw new Error('Unable to read the latency profile settings');
		const updated = await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(),
			type: 'spectra.settings.ui.patch', payload: { expectedRevision: current.data.revision,
				patch: { scope: 'global', changes: { pauseRetentionSeconds: 0 } } } });
		if (!updated?.ok) throw new Error('Unable to retain paused latency fixtures');
	});

	for (const url of mediaUrls) {
		const page = await browser.newPage();
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('#media')?.readyState ?? 0) >= 1);
		await page.bringToFront();
		await controlPage.waitForFunction(async (visitedUrl) => {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.id === undefined || tab.url !== visitedUrl) return false;
			const facts = (await chrome.storage.session.get('spectra.media-facts.v1'))['spectra.media-facts.v1'];
			return facts?.[String(tab.id)]?.outcome === 'found' && (facts[String(tab.id)].usedAt ?? 0) > 0;
		}, { polling: 50, timeout: 10_000 }, url);
		mediaPages.push(page);
	}
	// The real activation and durable use evidence have settled before measuring.
	for (const page of await browser.pages()) {
		if (page.url() === 'about:blank' || page.url() === '') {
			await page.close().catch(() => undefined);
		}
	}
}, 90_000);

afterAllChrome(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) {
		await rm(profileDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
	}
	server?.stop(true);
});

testChrome('records cold and warm popup media-list first-paint latency', async () => {
	const cold: number[] = [];
	const warm: number[] = [];
	await measurePopupOpen(3, 'prime', false);
	for (let sample = 0; sample < 2; sample += 1) {
		cold.push(await measurePopupOpen(3, `cold#${sample}`, true));
		warm.push(await measurePopupOpen(3, `warm#${sample}`, false));
	}
	const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
	console.log(`[latency] cold avg=${average(cold).toFixed(1)}ms samples=${cold.join(',')}`);
	console.log(`[latency] warm avg=${average(warm).toFixed(1)}ms samples=${warm.join(',')}`);
	expect(cold.length).toBe(2);
	expect(warm.length).toBe(2);
}, 180_000);
