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

test.describe('HALO lazy Hover Zoom runtime in Chromium', () => {
	test('keeps the viewer cold and preserves the first valid Alt gesture', async () => {
		test.setTimeout(30_000);
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
			await worker.evaluate(async () => {
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

			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});
			await page.goto(fixture.url, { waitUntil: 'load' });
			await expect(page.locator('#preview-target')).toBeVisible();

			// The static document_idle input host must not construct the heavy viewer.
			await expect(page.locator('#halo-hover-zoom-container')).toHaveCount(0);

			// Existing semantics allow the pointer to arrive before the modifier.
			// The very first Alt gesture must therefore survive the lazy import.
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expect(page.locator('#halo-hover-zoom-container')).toHaveCount(1);
			await expect(page.locator('#halo-hover-zoom-container .halo-hz-image')).toHaveAttribute(
				'src',
				/fixture\.svg/,
			);

			await page.keyboard.up('Alt');
			await expect.poll(async () => page.locator('#halo-hover-zoom-container').evaluate((element) => (
				(element as HTMLElement).style.display
			))).toBe('none');
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
