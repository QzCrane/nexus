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
	type Page,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const STORAGE_KEY = 'halo_hover_zoom_settings';
const VISIBLE_VIEWER = '#halo-hover-zoom-container .halo-hz-viewer.visible';

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
	const server = createServer((request, response) => {
		if (request.url === '/') {
			response.writeHead(200, {
				'Cache-Control': 'no-store',
				'Content-Type': 'text/html; charset=utf-8',
			});
			response.end(`<!doctype html>
<html>
<head><link rel="icon" href="data:,"></head>
<body>
	<div id="plain-target" style="width:160px;height:100px;margin:20px">plain target</div>
	<img id="preview-target" src="/fixture.svg" width="160" height="100" alt="HALO lazy preview fixture">
</body>
</html>`);
			return;
		}
		if (request.url === '/fixture.svg') {
			response.writeHead(200, {
				'Cache-Control': 'no-store',
				'Content-Type': 'image/svg+xml',
			});
			response.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="black"/></svg>');
			return;
		}
		response.writeHead(404).end('Not found');
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Hover Zoom fixture server did not expose a TCP address');
	}
	return { server, url: `http://127.0.0.1:${(address as AddressInfo).port}/` };
}

async function closeServer(server: Server | null): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function setHoverZoom(worker: Worker, enabled: boolean): Promise<void> {
	await worker.evaluate(async ({ key, value }) => {
		await chrome.storage.local.set({
			[key]: {
				enabled: value,
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
	}, { key: STORAGE_KEY, value: enabled });
}

async function expectViewerVisible(page: Page): Promise<void> {
	await expect(page.locator(VISIBLE_VIEWER)).toHaveCount(1, { timeout: 10_000 });
	await expect(page.locator('#halo-hover-zoom-container .halo-hz-image')).toHaveAttribute(
		'src',
		/fixture\.svg/,
	);
}

async function expectViewerHidden(page: Page): Promise<void> {
	await expect(page.locator(VISIBLE_VIEWER)).toHaveCount(0, { timeout: 10_000 });
}

test.describe('HALO lazy Hover Zoom runtime in Chromium', () => {
	test('keeps invalid and disabled pages cold while preserving every first valid gesture', async () => {
		test.setTimeout(45_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-hover-zoom-playwright-'));
		let server: Server | null = null;
		let context: BrowserContext | null = null;

		try {
			const fixture = await startFixtureServer();
			server = fixture.server;
			context = await chromium.launchPersistentContext(profilePath, {
				channel: 'chromium',
				headless: true,
				viewport: { width: 1_000, height: 700 },
				args: [
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});

			const browserErrors: string[] = [];
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			const worker = await extensionWorker(context);
			await setHoverZoom(worker, true);

			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});
			await page.goto(fixture.url, { waitUntil: 'load' });

			// The static host must reject an irrelevant Alt gesture without paying
			// the packaged ~48 KiB preview runtime cost.
			await page.locator('#plain-target').hover();
			await page.keyboard.down('Alt');
			await page.keyboard.up('Alt');
			await page.waitForTimeout(200);
			expect(await page.locator('#halo-hover-zoom-container').count()).toBe(0);

			// Pointer-before-modifier is canonical. The first valid Alt gesture must
			// survive the lazy import without asking the user for a second gesture.
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expectViewerVisible(page);
			await page.keyboard.up('Alt');
			await expectViewerHidden(page);

			// A fresh document may finish loading the runtime after a rapid release,
			// but the retired preview generation must never become visible later.
			await page.reload({ waitUntil: 'load' });
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await page.keyboard.up('Alt');
			await page.waitForTimeout(300);
			await expectViewerHidden(page);

			// Disabled state owns no page-input runtime. Re-enable must restore
			// first-gesture behavior after a real post-enable pointer movement.
			await setHoverZoom(worker, false);
			await page.reload({ waitUntil: 'load' });
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await page.waitForTimeout(200);
			expect(await page.locator('#halo-hover-zoom-container').count()).toBe(0);
			await page.keyboard.up('Alt');

			await page.mouse.move(10, 10);
			await setHoverZoom(worker, true);
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expectViewerVisible(page);
			await page.keyboard.up('Alt');
			await expectViewerHidden(page);

			expect(browserErrors).toEqual([]);
		} finally {
			await context?.close();
			await closeServer(server);
			await rm(profilePath, {
				force: true,
				recursive: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		}
	});
});
