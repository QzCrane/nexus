import { extensionWorker } from './helpers/extension-worker';
import { browserReplayPolicy } from '../../../scripts/browser-replay';
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
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
const RUNTIME_SUFFIX = '/tools/_hover-zoom/runtime.js';
const VIEWER = '#halo-hover-zoom-container';
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

async function settleRenderedTasks(page: Page): Promise<void> {
	await page.evaluate(() => new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	}));
}

async function installViewerVisibilityProbe(page: Page): Promise<void> {
	await page.evaluate(({ visibleSelector }) => {
		const root = document.documentElement;
		root.dataset.haloHoverZoomEverVisible = 'false';
		const sample = () => {
			if (document.querySelector(visibleSelector)) root.dataset.haloHoverZoomEverVisible = 'true';
		};
		new MutationObserver(sample).observe(root, {
			attributes: true,
			attributeFilter: ['class', 'style'],
			childList: true,
			subtree: true,
		});
		sample();
	}, { visibleSelector: VISIBLE_VIEWER });
}

function isHoverRuntimeUrl(url: string): boolean {
	return url.endsWith(RUNTIME_SUFFIX);
}

async function expectRealPreview(page: Page): Promise<void> {
	await expect(page.locator(VIEWER)).toHaveCount(1);
	await expect(page.locator(`${VIEWER} .halo-hz-image`)).toHaveAttribute('src', /fixture\.svg/);
}

async function expectViewerRetired(page: Page): Promise<void> {
	await expect.poll(async () => page.locator(VIEWER).evaluate((element) => (
		(element as HTMLElement).style.display
	))).toBe('none');
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
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
				headless: true,
				viewport: { width: 1_000, height: 700 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
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
			await expect(page.locator('#preview-target')).toBeVisible();

			// The static document_idle input host must not construct the heavy viewer.
			await expect(page.locator(VIEWER)).toHaveCount(0);

			// Existing semantics allow the pointer to arrive before the modifier.
			// The very first trusted Alt gesture must survive the lazy import.
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expectRealPreview(page);

			await page.keyboard.up('Alt');
			await expectViewerRetired(page);
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

	test('retires release-during-import and keeps disabled documents cold', async () => {
		test.setTimeout(40_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-hover-zoom-lifecycle-'));
		let server: Server | null = null;
		let context: BrowserContext | null = null;

		try {
			const fixture = await startFixtureServer();
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

			const browserErrors: string[] = [];
			let runtimeRequests = 0;
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			context.on('request', (request) => {
				if (isHoverRuntimeUrl(request.url())) runtimeRequests += 1;
			});
			const worker = await extensionWorker(context);
			await setHoverZoom(worker, true);

			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});

			// Force key release before dynamic import can settle: both DOM events are
			// dispatched in one browser task, while import() necessarily resolves later.
			await page.goto(fixture.url, { waitUntil: 'load' });
			await page.locator('#preview-target').hover();
			await installViewerVisibilityProbe(page);
			const runtimeFinished = context.waitForEvent('requestfinished', {
				predicate: (request) => isHoverRuntimeUrl(request.url()),
				timeout: 10_000,
			});
			await page.evaluate(() => {
				document.dispatchEvent(new KeyboardEvent('keydown', {
					key: 'Alt',
					code: 'AltLeft',
					altKey: true,
					bubbles: true,
					cancelable: true,
				}));
				document.dispatchEvent(new KeyboardEvent('keyup', {
					key: 'Alt',
					code: 'AltLeft',
					altKey: false,
					bubbles: true,
					cancelable: true,
				}));
			});
			await runtimeFinished;
			await settleRenderedTasks(page);
			expect(await page.locator('html').getAttribute('data-halo-hover-zoom-ever-visible')).toBe('false');
			expect(await page.locator(VISIBLE_VIEWER).count()).toBe(0);

			// A fresh disabled document must not even request the 48 KiB runtime.
			await setHoverZoom(worker, false);
			await page.reload({ waitUntil: 'load' });
			const requestsBeforeDisabledGesture = runtimeRequests;
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await page.keyboard.up('Alt');
			await settleRenderedTasks(page);
			expect(runtimeRequests).toBe(requestsBeforeDisabledGesture);
			expect(await page.locator(VIEWER).count()).toBe(0);

			// Re-enable through persistent authority, then a fresh document must restore
			// the same first trusted gesture without needing a warm-up interaction.
			await setHoverZoom(worker, true);
			await page.reload({ waitUntil: 'load' });
			await page.locator('#preview-target').hover();
			await page.keyboard.down('Alt');
			await expectRealPreview(page);
			await page.keyboard.up('Alt');
			await expectViewerRetired(page);
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
