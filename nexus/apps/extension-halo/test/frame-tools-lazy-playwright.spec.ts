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
	type Frame,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));

interface FrameToolResponse {
	loaded?: boolean;
	success?: boolean;
}

async function startFixtureServer(): Promise<{
	childOrigin: string;
	server: Server;
	topUrl: string;
}> {
	let port = 0;
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
	<p>HALO frame-tools top fixture</p>
	<iframe id="cross-origin-frame" src="http://127.0.0.2:${port}/frame"></iframe>
</body>
</html>`);
			return;
		}
		if (request.url === '/frame') {
			response.writeHead(200, {
				'Cache-Control': 'no-store',
				'Content-Type': 'text/html; charset=utf-8',
			});
			response.end(
				'<!doctype html><html><head><link rel="icon" href="data:,"></head><body><p>cross-origin child fixture</p></body></html>',
			);
			return;
		}
		response.writeHead(404).end('Not found');
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '0.0.0.0', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Frame-tools fixture server did not expose a TCP address');
	}
	port = (address as AddressInfo).port;
	return {
		childOrigin: `http://127.0.0.2:${port}`,
		server,
		topUrl: `http://127.0.0.1:${port}/`,
	};
}

async function closeServer(server: Server | null): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

async function sendFrameTool(worker: Worker, type: string): Promise<FrameToolResponse> {
	return worker.evaluate(async (messageType) => {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) throw new Error('HALO frame-tools test has no active tab');
		return chrome.tabs.sendMessage(tab.id, { type: messageType }) as Promise<FrameToolResponse>;
	}, type);
}

async function crossOriginChild(contextFrame: Frame, origin: string): Promise<Frame> {
	await expect.poll(
		() => contextFrame.childFrames().some((frame) => frame.url().startsWith(origin)),
		{ timeout: 10_000 },
	).toBe(true);
	const child = contextFrame.childFrames().find((frame) => frame.url().startsWith(origin));
	if (!child) throw new Error(`Cross-origin frame did not load from ${origin}`);
	return child;
}

test.describe('HALO lazy frame tools in Chromium', () => {
	test('loads the heavy runtime only on activation and preserves cross-origin frame coverage', async () => {
		test.setTimeout(30_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-frame-tools-playwright-'));
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
			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});
			await page.goto(fixture.topUrl, { waitUntil: 'load' });
			const child = await crossOriginChild(page.mainFrame(), fixture.childOrigin);

			// A cleanup command before first activation must be handled by the tiny
			// bootstrap without importing the heavy ESM runtime in any frame.
			const coldCancel = await sendFrameTool(worker, 'HALO_RULER_CANCEL');
			expect(coldCancel).toMatchObject({ success: true, loaded: false });
			expect(await page.locator('#halo-ruler-overlay').count()).toBe(0);
			expect(await child.locator('#halo-ruler-overlay').count()).toBe(0);

			// One tab broadcast reaches both static all-frame bootstraps. Each frame
			// lazy-imports the packaged runtime and executes the same command.
			const started = await sendFrameTool(worker, 'HALO_RULER_START');
			expect(started).toMatchObject({ success: true, loaded: true });
			await expect(page.locator('#halo-ruler-overlay')).toHaveCount(1);
			await expect(child.locator('#halo-ruler-overlay')).toHaveCount(1);

			const cancelled = await sendFrameTool(worker, 'HALO_RULER_CANCEL');
			expect(cancelled).toMatchObject({ success: true, loaded: true });
			await expect(page.locator('#halo-ruler-overlay')).toHaveCount(0);
			await expect(child.locator('#halo-ruler-overlay')).toHaveCount(0);
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
