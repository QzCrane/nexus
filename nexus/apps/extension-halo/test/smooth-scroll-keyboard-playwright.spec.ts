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
} from '@playwright/test';

const KEYBOARD_STEP_PX = 300;
const REPEAT_NORMALIZATION_INTERVAL_MS = 80;

interface KeyboardProbeSnapshot {
	arrowClaims: number;
	lastAnyArrowCancelBubble: boolean | null;
	lastAnyArrowDefaultPrevented: boolean | null;
	lastArrowDefaultPrevented: boolean | null;
	lastSpaceDefaultPrevented: boolean | null;
	lastStopArrowDefaultPrevented: boolean | null;
	spaceClaims: number;
	stopArrowClaims: number;
	trustedArrowEvents: number;
	volume: number;
}

declare global {
	interface Window {
		__haloKeyboardProbe: {
			installLateSiteHandlers(): void;
			reset(): void;
			setArrowOwner(enabled: boolean): void;
			setStopArrowOwner(enabled: boolean): void;
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
			let stopArrowOwnerEnabled = false;
			let arrowClaims = 0;
			let stopArrowClaims = 0;
			let spaceClaims = 0;
			let trustedArrowEvents = 0;
			let lastAnyArrowEvent = null;
			let lastArrowEvent = null;
			let lastStopArrowEvent = null;
			let lastSpaceEvent = null;

			document.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowDown') return;
				if (event.isTrusted) trustedArrowEvents++;
				lastAnyArrowEvent = event;
			});

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
						lastArrowEvent = event;
					});
					document.addEventListener('keydown', (event) => {
						if (event.key === 'ArrowDown' && stopArrowOwnerEnabled) {
							stopArrowClaims++;
							event.stopPropagation();
							lastStopArrowEvent = event;
							return;
						}
						if (event.key !== ' ') return;
						spaceClaims++;
						event.preventDefault();
						event.stopPropagation();
						lastSpaceEvent = event;
					});
				},
				reset() {
					arrowClaims = 0;
					stopArrowClaims = 0;
					spaceClaims = 0;
					trustedArrowEvents = 0;
					lastAnyArrowEvent = null;
					lastArrowEvent = null;
					lastStopArrowEvent = null;
					lastSpaceEvent = null;
					player.volume = 1;
					window.scrollTo({ top: 0, behavior: 'instant' });
					document.body.focus();
				},
				setArrowOwner(enabled) {
					arrowOwnerEnabled = enabled;
				},
				setStopArrowOwner(enabled) {
					stopArrowOwnerEnabled = enabled;
				},
				snapshot() {
					return {
						arrowClaims,
						lastAnyArrowCancelBubble: lastAnyArrowEvent?.cancelBubble ?? null,
						lastAnyArrowDefaultPrevented: lastAnyArrowEvent?.defaultPrevented ?? null,
						lastArrowDefaultPrevented: lastArrowEvent?.defaultPrevented ?? null,
						lastSpaceDefaultPrevented: lastSpaceEvent?.defaultPrevented ?? null,
						lastStopArrowDefaultPrevented: lastStopArrowEvent?.defaultPrevented ?? null,
						spaceClaims,
						stopArrowClaims,
						trustedArrowEvents,
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

interface RepeatArrowResult {
	position: number;
	deliveryDurationMs: number;
}

async function waitUntil(deadline: number): Promise<void> {
	while (true) {
		const remaining = deadline - performance.now();
		if (remaining <= 0) return;
		await new Promise((resolve) => setTimeout(resolve, remaining));
	}
}

async function repeatArrowStream(
	page: Page,
	firstRepeatDelayMs: number,
	repeatIntervalMs: number,
	repeatCount: number,
): Promise<RepeatArrowResult> {
	await resetFixture(page);
	await page.keyboard.down('ArrowDown');
	const initialDeliveredAt = performance.now();
	for (let index = 0; index < repeatCount; index++) {
		await waitUntil(initialDeliveredAt + firstRepeatDelayMs + index * repeatIntervalMs);
		await page.keyboard.down('ArrowDown');
	}
	const deliveryDurationMs = performance.now() - initialDeliveredAt;
	await page.keyboard.up('ArrowDown');
	return {
		position: await waitForScrollSettled(page),
		deliveryDurationMs,
	};
}

async function enableSmoothScroll(context: BrowserContext): Promise<string> {
	let [serviceWorker] = context.serviceWorkers();
	if (!serviceWorker) {
		serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
	}
	const extensionId = new URL(serviceWorker.url()).hostname;
	if (!extensionId) throw new Error(`HALO service worker has no extension id: ${serviceWorker.url()}`);
	const grantedOrigins = await serviceWorker.evaluate(async () => {
		return (await chrome.permissions.getAll()).origins ?? [];
	});
	if (!grantedOrigins.includes('<all_urls>')) {
		throw new Error(`HALO static content-script grant is missing <all_urls>: ${JSON.stringify(grantedOrigins)}`);
	}
	await serviceWorker.evaluate(async (storageKey) => {
		await chrome.storage.sync.set({
			[storageKey]: { enabled: true, keyboard: true, arrowKeyStep: 300 },
		});
	}, 'HALO_SMOOTH_SCROLL_SETTINGS');
	return extensionId;
}

async function waitForSmoothScrollReady(
	page: Page,
	browserErrors: readonly string[],
): Promise<void> {
	const deadline = Date.now() + 10_000;
	let lastPosition = -1;
	let lastProbe: KeyboardProbeSnapshot | null = null;
	while (Date.now() < deadline) {
		await resetFixture(page);
		await page.keyboard.press('ArrowDown');
		lastPosition = await waitForScrollSettled(page);
		lastProbe = await page.evaluate(() => window.__haloKeyboardProbe.snapshot());
		// Native ArrowDown scrolling is much smaller than HALO's configured
		// coarse keyboard command. Require the extension-owned trajectory instead
		// of waiting on a production console.log that is tree-shaken.
		if (lastPosition >= KEYBOARD_STEP_PX - 50) {
			await resetFixture(page);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(
		`HALO Smooth Scroll did not acquire keyboard ownership within 10s; ` +
		`scrollY=${lastPosition}; probe=${JSON.stringify(lastProbe)}; ` +
		`browserErrors=${JSON.stringify(browserErrors)}`,
	);
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
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
				headless: true,
				viewport: { width: 1_100, height: 700 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});
			const browserErrors: string[] = [];
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			const extensionId = await enableSmoothScroll(context);
			expect(extensionId.length).toBeGreaterThan(0);
			const page = context.pages()[0] ?? await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});
			await page.goto(fixture.url, { waitUntil: 'load' });
			await waitForSmoothScrollReady(page, browserErrors);

			// A large, connected but offscreen video is not ownership evidence.
			await page.keyboard.press('ArrowDown');
			const unclaimedPosition = await waitForScrollSettled(page);
			expect(unclaimedPosition).toBeCloseTo(KEYBOARD_STEP_PX, 0);

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
			await page.evaluate(() => {
				window.__haloKeyboardProbe.setArrowOwner(false);
				window.__haloKeyboardProbe.setStopArrowOwner(true);
			});
			await page.keyboard.press('ArrowDown');
			const propagationOwnedPosition = await waitForScrollSettled(page);
			const propagationOwned = await page.evaluate(() => window.__haloKeyboardProbe.snapshot());
			expect(propagationOwned.stopArrowClaims).toBe(1);
			expect(propagationOwned.lastStopArrowDefaultPrevented).toBe(false);
			expect(propagationOwnedPosition).toBeLessThan(200);

			await resetFixture(page);
			await page.evaluate(() => window.__haloKeyboardProbe.setStopArrowOwner(false));
			await page.keyboard.press('Space');
			await nextFrame(page);
			const prevented = await page.evaluate(() => ({
				probe: window.__haloKeyboardProbe.snapshot(),
				scrollY: window.scrollY,
			}));
			expect(prevented.probe.spaceClaims).toBe(1);
			expect(prevented.probe.lastSpaceDefaultPrevented).toBe(true);
			expect(prevented.scrollY).toBe(0);

			// Hold the same wall-clock window with the same first-repeat delay and
			// vary only repeat delivery frequency. The resulting trajectories may
			// differ by at most one configured Arrow step; first-repeat delay itself
			// is tested separately below and is intentionally never backfilled.
			const fastRepeat = await repeatArrowStream(page, 200, 20, 11);
			const mediumRepeat = await repeatArrowStream(page, 200, 50, 5);
			const sparseRepeat = await repeatArrowStream(page, 200, 200, 2);
			const streams = [fastRepeat, mediumRepeat, sparseRepeat];
			const deliverySpan = Math.max(...streams.map((item) => item.deliveryDurationMs)) -
				Math.min(...streams.map((item) => item.deliveryDurationMs));
			expect(deliverySpan, JSON.stringify(streams)).toBeLessThanOrEqual(
				REPEAT_NORMALIZATION_INTERVAL_MS,
			);
			const normalizedSpan = Math.max(...streams.map((item) => item.position)) -
				Math.min(...streams.map((item) => item.position));
			expect(normalizedSpan, JSON.stringify(streams)).toBeLessThanOrEqual(KEYBOARD_STEP_PX);

			const delayedFirstRepeat = await repeatArrowStream(page, 500, 80, 1);
			// One initial press plus the first repeat: no synthetic catch-up is
			// allowed for the OS-owned 500ms initial repeat delay.
			expect(delayedFirstRepeat.position).toBeCloseTo(KEYBOARD_STEP_PX * 2, 0);
		} finally {
			await context?.close();
			await closeFixtureServer(server);
			await rm(profilePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
		}
	});
});
