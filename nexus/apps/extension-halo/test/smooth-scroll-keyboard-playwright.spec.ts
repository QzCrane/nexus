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
} from '@playwright/test';

interface KeyboardProbeSnapshot {
	arrowClaims: number;
	lastArrowDefaultPrevented: boolean | null;
	lastSpaceDefaultPrevented: boolean | null;
	spaceClaims: number;
	volume: number;
}

declare global {
	interface Window {
		__haloKeyboardProbe: {
			installLateSiteHandlers(): void;
			reset(): void;
			setArrowOwner(enabled: boolean): void;
			snapshot(): KeyboardProbeSnapshot;
		};
	}
}

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>HALO keyboard ownership regression</title>
	<style>
		html, body { margin: 0; min-height: 6400px; }
		body { font: 16px system-ui, sans-serif; }
		#offscreen-player {
			position: absolute;
			top: 2600px;
			left: 0;
			width: 100vw;
			height: 620px;
			background: #111827;
		}
	</style>
</head>
<body tabindex="-1">
	<p>Keyboard ownership fixture</p>
	<video id="offscreen-player" muted playsinline preload="none"></video>
	<script>
		(() => {
			const player = document.getElementById('offscreen-player');
			let installed = false;
			let arrowOwnerEnabled = false;
			let arrowClaims = 0;
			let spaceClaims = 0;
			let lastArrowDefaultPrevented = null;
			let lastSpaceDefaultPrevented = null;

			window.__haloKeyboardProbe = {
				installLateSiteHandlers() {
					if (installed) return;
					installed = true;
					// Registered after the extension initialized. HALO must still
					// finalize after this listener rather than relying on static order.
					window.addEventListener('keydown', (event) => {
						if (event.key !== 'ArrowDown' || !arrowOwnerEnabled) return;
						arrowClaims++;
						player.volume = Math.max(0, player.volume - 0.1);
						queueMicrotask(() => {
							lastArrowDefaultPrevented = event.defaultPrevented;
						});
					});
					document.addEventListener('keydown', (event) => {
						if (event.key !== ' ') return;
						spaceClaims++;
						event.preventDefault();
						event.stopPropagation();
						queueMicrotask(() => {
							lastSpaceDefaultPrevented = event.defaultPrevented;
						});
					});
				},
				reset() {
					arrowClaims = 0;
					spaceClaims = 0;
					lastArrowDefaultPrevented = null;
					lastSpaceDefaultPrevented = null;
					player.volume = 1;
					window.scrollTo({ top: 0, behavior: 'instant' });
					document.body.focus();
				},
				setArrowOwner(enabled) {
					arrowOwnerEnabled = enabled;
				},
				snapshot() {
					return {
						arrowClaims,
						lastArrowDefaultPrevented,
						lastSpaceDefaultPrevented,
						spaceClaims,
						volume: player.volume,
					};
				},
			};
		})();
	</script>
</body>
</html>`;

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
	const server = createServer((request, response) => {
		if (request.url !== '/') {
			response.writeHead(404).end('Not found');
			return;
		}
		response.writeHead(200, {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
		});
		response.end(FIXTURE_HTML);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not expose a TCP address');
	}
	return {
		server,
		url: `http://127.0.0.1:${(address as AddressInfo).port}/`,
	};
}

async function closeFixtureServer(server: Server | null): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

async function nextFrame(page: Page): Promise<void> {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);
}

async function resetFixture(page: Page): Promise<void> {
	await page.evaluate(() => window.__haloKeyboardProbe.reset());
	await nextFrame(page);
}

async function waitForScrollSettled(page: Page): Promise<number> {
	return page.evaluate(() => new Promise<number>((resolve) => {
		let last = window.scrollY;
		let stableFrames = 0;
		let frames = 0;
		const sample = () => {
			frames++;
			const current = window.scrollY;
			if (Math.abs(current - last) <= 0.1) stableFrames++;
			else stableFrames = 0;
			last = current;
			if (frames >= 4 && stableFrames >= 8) {
				resolve(current);
				return;
			}
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}));
}

async function repeatArrowStream(
	page: Page,
	intervalMs: number,
	repeatCount: number,
): Promise<number> {
	await resetFixture(page);
	await page.keyboard.down('ArrowDown');
	for (let index = 0; index < repeatCount; index++) {
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		await page.keyboard.down('ArrowDown');
	}
	await page.keyboard.up('ArrowDown');
	return waitForScrollSettled(page);
}

test.describe('HALO keyboard ownership in Chromium', () => {
	test('resolves site ownership after bubble handlers and normalizes repeat rate', async () => {
		test.setTimeout(30_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-keyboard-playwright-'));
		let server: Server | null = null;
		let context: BrowserContext | null = null;

		try {
			const fixture = await startFixtureServer();
			server = fixture.server;
			context = await chromium.launchPersistentContext(profilePath, {
				channel: 'chromium',
				headless: true,
				viewport: { width: 1_100, height: 700 },
				args: [
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});
			const page = context.pages()[0] ?? await context.newPage();
			const contentReady = page.waitForEvent('console', {
				predicate: (message) => message.text().includes('[HALO] Content script ready in'),
				timeout: 10_000,
			});
			await page.goto(fixture.url, { waitUntil: 'load' });
			await contentReady;
			await resetFixture(page);

			// A large, connected but offscreen video is not ownership evidence.
			await page.keyboard.press('ArrowDown');
			const unclaimedPosition = await waitForScrollSettled(page);
			expect(unclaimedPosition).toBeCloseTo(300, 0);

			await resetFixture(page);
			await page.evaluate(() => {
				window.__haloKeyboardProbe.installLateSiteHandlers();
				window.__haloKeyboardProbe.setArrowOwner(true);
			});
			await page.keyboard.press('ArrowDown');
			await nextFrame(page);
			const mediaOwned = await page.evaluate(() => ({
				probe: window.__haloKeyboardProbe.snapshot(),
				scrollY: window.scrollY,
			}));
			expect(mediaOwned.probe.arrowClaims).toBe(1);
			expect(mediaOwned.probe.volume).toBeCloseTo(0.9, 5);
			expect(mediaOwned.probe.lastArrowDefaultPrevented).toBe(true);
			expect(mediaOwned.scrollY).toBe(0);

			await resetFixture(page);
			await page.keyboard.press('Space');
			await nextFrame(page);
			const prevented = await page.evaluate(() => ({
				probe: window.__haloKeyboardProbe.snapshot(),
				scrollY: window.scrollY,
			}));
			expect(prevented.probe.spaceClaims).toBe(1);
			expect(prevented.probe.lastSpaceDefaultPrevented).toBe(true);
			expect(prevented.scrollY).toBe(0);

			await page.evaluate(() => window.__haloKeyboardProbe.setArrowOwner(false));
			const fastRepeat = await repeatArrowStream(page, 20, 16);
			const mediumRepeat = await repeatArrowStream(page, 50, 6);
			const sparseRepeat = await repeatArrowStream(page, 200, 2);
			const delayedFirstRepeat = await repeatArrowStream(page, 500, 1);

			expect(fastRepeat).toBeGreaterThanOrEqual(1_200);
			expect(mediumRepeat).toBeGreaterThanOrEqual(900);
			expect(sparseRepeat).toBeGreaterThanOrEqual(900);
			expect(fastRepeat).toBeLessThanOrEqual(1_900);
			expect(mediumRepeat).toBeLessThanOrEqual(1_900);
			expect(sparseRepeat).toBeLessThanOrEqual(1_900);
			expect(Math.abs(fastRepeat - mediumRepeat)).toBeLessThanOrEqual(400);
			expect(Math.abs(fastRepeat - sparseRepeat)).toBeLessThanOrEqual(500);
		// The operating system's first-repeat delay is preserved, not backfilled.
			expect(delayedFirstRepeat).toBeGreaterThanOrEqual(500);
			expect(delayedFirstRepeat).toBeLessThanOrEqual(800);
		} finally {
			await context?.close();
			await closeFixtureServer(server);
			await rm(profilePath, { force: true, recursive: true });
		}
	});
});
