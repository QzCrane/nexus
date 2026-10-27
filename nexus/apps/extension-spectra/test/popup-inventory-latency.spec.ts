// goal: measure real Popup -> media-card first-paint latency under cold and warm service-worker states
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { expect } from 'bun:test';
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

async function stopServiceWorker(): Promise<void> {
	// Natural MV3 idle stop: open/close the popup, then wait past the 30s idle
	// timeout. The CDP workerVersionUpdated events are unreliable in headless
	// extension runs, so the natural path is the deterministic one.
	const knownTargets = new Set(browser.targets());
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target) && target.url() === `chrome-extension://${extensionId}/popup.html`,
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
		(target) => !knownTargets.has(target) && target.url() === `chrome-extension://${extensionId}/popup.html`,
		{ timeout: 10_000 },
	);
	await controlPage.evaluate(async () => chrome.action.openPopup());
	const target = await targetPromise;
	const popup = await target.asPage();
	if (!popup) throw new Error('no popup page');
	const attached = performance.now();
	try {
		// Stage 1: the inventory evidence arrives (spectra.tab.visible.list round trip).
		await popup.waitForFunction(() => {
			const value = document.documentElement.dataset.mediaInventory;
			return value !== undefined && value !== '' && value !== 'unavailable';
		}, { timeout: 15_000 });
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
			inventoryStatusText: document.getElementById('media-inventory-status')?.textContent ?? '',
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
			const slug = url.pathname.slice('/media/'.length);
			if (url.pathname.startsWith('/media/') && ['alpha', 'beta', 'gamma'].includes(slug)) {
				return new Response(`<!doctype html><html><head><title>Paused Media ${slug}</title></head><body><video controls></video></body></html>`, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
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

	for (const url of mediaUrls) {
		const page = await browser.newPage();
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		mediaPages.push(page);
	}
	// Let the bootstrap media reports settle into durable facts before measuring.
	await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
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
