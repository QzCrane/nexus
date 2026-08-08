import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const STORAGE_KEY = 'halo_hover_zoom_settings';
const VISIBLE_VIEWER = '#halo-hover-zoom-container .halo-hz-viewer.visible';

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
	const server = createServer((request, response) => {
		if (request.url === '/image.svg') {
			response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'image/svg+xml' });
			response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="black"/></svg>');
			return;
		}
		if (request.url === '/') {
			response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
			response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body>
<img id="target" src="/image.svg" alt="Hover target" width="160" height="120" style="margin:100px">
</body></html>`);
			return;
		}
		response.writeHead(404).end('Not found');
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Hover Zoom fixture server has no TCP address');
	return { server, url: `http://127.0.0.1:${(address as AddressInfo).port}/` };
}

async function closeServer(server: Server | null): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function setHoverZoom(worker: Worker, enabled: boolean): Promise<void> {
	await worker.evaluate(async ({ key, value }) => {
		await chrome.storage.local.set({
			[key]: {
				enabled: value,
				triggerDelay: 0,
				altKeyMode: 'block',
			},
		});
	}, { key: STORAGE_KEY, value: enabled });
}

async function hoverTarget(page: import('@playwright/test').Page): Promise<void> {
	const box = await page.locator('#target').boundingBox();
	if (!box) throw new Error('Hover target has no bounding box');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function expectViewerVisible(page: import('@playwright/test').Page): Promise<void> {
	await expect(page.locator(VISIBLE_VIEWER)).toHaveCount(1, { timeout: 10_000 });
}

async function expectViewerHidden(page: import('@playwright/test').Page): Promise<void> {
	await expect(page.locator(VISIBLE_VIEWER)).toHaveCount(0, { timeout: 10_000 });
}

test.describe('HALO lazy Hover Zoom runtime in Chromium', () => {
	test('preserves first gesture, release-during-import, and disable/re-enable semantics', async () => {
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
				args: [`--disable-extensions-except=${DIST_PATH}`, `--load-extension=${DIST_PATH}`],
			});

			const errors: string[] = [];
			context.on('weberror', (error) => errors.push(String(error.error())));
			const worker = await extensionWorker(context);
			await setHoverZoom(worker, true);
			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
			page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

			// A fresh content world must complete the very first configured gesture;
			// the user must not need to press Alt a second time after the lazy import.
			await page.goto(fixture.url, { waitUntil: 'load' });
			await hoverTarget(page);
			await page.keyboard.down('Alt');
			await expectViewerVisible(page);
			await page.keyboard.up('Alt');
			await expectViewerHidden(page);

			// On a new document, release while the runtime import is still eligible.
			// The runtime may finish loading, but the released gesture must never become visible.
			await page.reload({ waitUntil: 'load' });
			await hoverTarget(page);
			await page.keyboard.down('Alt');
			await page.keyboard.up('Alt');
			await page.waitForTimeout(300);
			await expectViewerHidden(page);

			// Disabled mode must stay event-free from the heavy runtime perspective;
			// storage re-enable then restores the same first-gesture behavior.
			await setHoverZoom(worker, false);
			await page.reload({ waitUntil: 'load' });
			await hoverTarget(page);
			await page.keyboard.down('Alt');
			await page.waitForTimeout(200);
			expect(await page.locator('#halo-hover-zoom-container').count()).toBe(0);
			await page.keyboard.up('Alt');

			await setHoverZoom(worker, true);
			await hoverTarget(page);
			await page.keyboard.down('Alt');
			await expectViewerVisible(page);
			await page.keyboard.up('Alt');
			await expectViewerHidden(page);
			expect(errors).toEqual([]);
		} finally {
			await context?.close();
			await closeServer(server);
			await rm(profilePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
		}
	});
});
