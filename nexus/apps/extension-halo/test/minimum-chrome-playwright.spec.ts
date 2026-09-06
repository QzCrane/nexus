import { browserReplayPolicy } from '../../../scripts/browser-replay';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromium,
	expect,
	test,
	type BrowserContext,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
const VIEWER = '#halo-hover-zoom-container';

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function startFixture(): Promise<{ server: Server; url: string }> {
	const server = createServer((request, response) => {
		if (request.url === '/fixture.svg') {
			response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
			response.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="black"/></svg>');
			return;
		}
		if (request.url !== '/') {
			response.writeHead(404).end('Not found');
			return;
		}
		response.writeHead(200, {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
		});
		response.end(`<!doctype html><html><head><title>HALO Chrome Floor</title></head><body style="min-height:6400px"><img id="preview-target" src="/fixture.svg" width="160" height="100" alt="preview"></body></html>`);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('HALO Chrome-floor fixture has no TCP address');
	return { server, url: `http://127.0.0.1:${(address as AddressInfo).port}/` };
}

async function closeServer(server: Server | null): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

async function enableRuntimeFeatures(worker: Worker): Promise<void> {
	await worker.evaluate(async () => {
		await chrome.storage.sync.set({
			HALO_SMOOTH_SCROLL_SETTINGS: { enabled: true, keyboard: true, arrowKeyStep: 300 },
		});
		await chrome.storage.local.set({
			halo_hover_zoom_settings: {
				enabled: true,
				triggerDelay: 0,
				altKeyMode: 'block',
				highlightMode: 'hotkey',
				showLoadingIndicator: false,
				resourceKeys: {
					imageKey: { shift: false, ctrl: false, alt: true },
					videoKey: { shift: false, ctrl: true, alt: true },
				},
			},
		});
	});
}

async function currentTabId(worker: Worker, url: string): Promise<number> {
	return worker.evaluate(async (targetUrl) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`HALO compatibility tab missing: ${targetUrl}`);
		return tab.id;
	}, url);
}

async function sendFrameCommand(worker: Worker, tabId: number, type: string): Promise<void> {
	await worker.evaluate(async ({ targetTabId, messageType }) => {
		const response = await chrome.tabs.sendMessage(targetTabId, { type: messageType });
		if (!response?.success) throw new Error(`HALO frame command failed: ${messageType}`);
	}, { targetTabId: tabId, messageType: type });
}

async function assertPinnedBrowser(context: BrowserContext): Promise<void> {
	if (!EXPECTED_CHROME) return;
	const browser = context.browser();
	if (!browser) throw new Error('Persistent Chromium context has no browser owner');
	expect(browser.version()).toContain(EXPECTED_CHROME);
}

test.describe('HALO declared minimum Chrome compatibility', () => {
	test('runs admitted SidePanel and page capabilities on the pinned browser floor', async () => {
		test.setTimeout(45_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-minimum-chrome-'));
		let context: BrowserContext | null = null;
		let server: Server | null = null;
		try {
			const fixture = await startFixture();
			server = fixture.server;
			context = await chromium.launchPersistentContext(profilePath, {
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
				headless: true,
				viewport: { width: 1_000, height: 700 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});
			await assertPinnedBrowser(context);
			const browserErrors: string[] = [];
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			const worker = await extensionWorker(context);
			await enableRuntimeFeatures(worker);
			const extensionId = new URL(worker.url()).hostname;

			// Renderer + admitted-panel boundary.
			const sidepanel = await context.newPage();
			sidepanel.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
			const jsonTool = sidepanel.locator('button[data-tool-id="json-formatter"]');
			await expect(jsonTool).toBeVisible();
			await expect(jsonTool).toBeEnabled();
			await jsonTool.click();
			await expect(sidepanel.locator('textarea').first()).toBeVisible();

			// document_start Smooth Scroll, exact Ruler lazy runtime, and document_idle Hover Zoom.
			const page = await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			await page.goto(fixture.url, { waitUntil: 'load' });
			await page.keyboard.press('ArrowDown');
			await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(200);
			await page.evaluate(() => window.scrollTo(0, 0));

			const tabId = await currentTabId(worker, fixture.url);
			await sendFrameCommand(worker, tabId, 'HALO_RULER_START');
			await expect(page.locator('#halo-ruler-overlay')).toHaveCount(1);
			await sendFrameCommand(worker, tabId, 'HALO_RULER_CANCEL');
			await expect(page.locator('#halo-ruler-overlay')).toHaveCount(0);

			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expect(page.locator(VIEWER)).toHaveCount(1);
			await expect(page.locator(`${VIEWER} .halo-hz-image`)).toHaveAttribute('src', /fixture\.svg/u);
			await page.keyboard.up('Alt');

			expect(browserErrors).toEqual([]);
		} finally {
			await context?.close();
			await closeServer(server);
			await rm(profilePath, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});
});
