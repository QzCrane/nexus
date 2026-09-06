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

interface FrameSample {
	time: number;
	outerTop: number;
	hiddenTop: number;
}

interface WheelRecord {
	defaultPrevented: boolean;
	deltaY: number;
	targetId: string;
}

interface FixtureSnapshot {
	fineTop: number;
	hiddenTop: number;
	lastWheelSampleIndex: number;
	outerTop: number;
	samples: FrameSample[];
	shadowTop: number;
	siteArrowKeys: number;
	wheels: WheelRecord[];
}

declare global {
	interface Window {
		__haloFixture: {
			installWheelProbe(): void;
			reset(
				scrollerId: 'fine-scroller' | 'media-scroller' | 'shadow-scroller' | 'viewport',
			): void;
			stallBeforeNextWheel(durationMs: number): void;
			startSampling(): void;
			snapshot(): FixtureSnapshot;
		};
	}
}

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const MICRO_WHEEL_DELTA = 1;
const FINE_WHEEL_DELTA = 48.5;
const MEDIA_WHEEL_DELTA = 52.5;
const SHADOW_WHEEL_DELTA = 60.5;
const SLOT_WHEEL_DELTA = 64.5;
const VIEWPORT_WHEEL_DELTA = 56.5;
const COARSE_WHEEL_DISTANCE = 300;
const SETTLE_TOLERANCE = 0.75;

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>HALO smooth-scroll browser regression</title>
	<style>
		* { box-sizing: border-box; }
		html, body {
			height: 100%;
			margin: 0;
			overflow: hidden;
			background: #0f172a;
			color: #e2e8f0;
			font: 16px/1.5 system-ui, sans-serif;
		}
		body {
			display: flex;
			gap: 32px;
			align-items: flex-start;
			padding: 32px;
		}
		.scroller {
			width: 420px;
			height: 300px;
			overflow-y: auto;
			overscroll-behavior-y: contain;
			scroll-behavior: auto;
			border: 2px solid #64748b;
			border-radius: 12px;
			background: #1e293b;
		}
		.hit {
			height: 150px;
			padding: 32px;
			background: #334155;
		}
		#shadow-host {
			display: block;
			height: 150px;
			padding: 10px;
			background: #164e63;
		}
		.filler {
			height: 1200px;
			background: linear-gradient(#475569, #0f172a);
		}
		#hidden-media-layout {
			height: 190px;
			overflow: hidden;
			padding: 12px;
			background: #312e81;
		}
		#video-target {
			display: block;
			width: 340px;
			height: 140px;
			background: #111827;
			border: 2px solid #818cf8;
		}
		#hidden-overflow-content {
			height: 700px;
			background: #4c1d95;
		}
		#page-focus {
			height: 80px;
			padding: 24px;
			outline: none;
			background: #0f766e;
		}
	</style>
</head>
<body>
	<div id="fine-scroller" class="scroller">
		<div id="fine-target" class="hit">Fine-grained wheel target</div>
		<div id="shadow-host">
			<div id="slotted-target">Slotted wheel target</div>
		</div>
		<div class="filler"></div>
	</div>
	<div id="media-scroller" class="scroller">
		<div id="hidden-media-layout">
			<video
				id="video-target"
				aria-label="Video routing target"
				muted
				playsinline
				preload="none"
			></video>
			<div id="hidden-overflow-content"></div>
		</div>
		<div id="page-focus" tabindex="0">Page keyboard owner</div>
		<div class="filler"></div>
	</div>
	<script>
		(() => {
			const shadowHost = document.getElementById('shadow-host');
			const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
			shadowRoot.innerHTML = \`
				<style>
					#shadow-scroller {
						height: 130px;
						overflow-y: auto;
						overscroll-behavior-y: contain;
						background: #083344;
					}
					.shadow-hit, ::slotted(#slotted-target) {
						display: block;
						height: 48px;
						padding: 12px;
						background: #155e75;
					}
					.shadow-filler {
						height: 700px;
						background: linear-gradient(#0e7490, #083344);
					}
				</style>
				<div id="shadow-scroller">
					<div id="shadow-target" class="shadow-hit">Open shadow wheel target</div>
					<slot></slot>
					<div class="shadow-filler"></div>
				</div>
			\`;
			let activeScrollerId = 'fine-scroller';
			let samples = [];
			let wheels = [];
			let wheelProbeInstalled = false;
			let lastWheelSampleIndex = -1;
			let sampleFrame = 0;
			let sampling = false;
			let siteArrowKeys = 0;
			let stallBeforeNextWheelMs = 0;
			const maxSamples = 240;
			const getShadowScroller = () =>
				shadowRoot.getElementById('shadow-scroller');
			const readActiveTop = () => {
				if (activeScrollerId === 'viewport') return window.scrollY;
				if (activeScrollerId === 'shadow-scroller') {
					return getShadowScroller().scrollTop;
				}
				return document.getElementById(activeScrollerId).scrollTop;
			};

			const sample = (time) => {
				if (!sampling) return;
				const hidden = document.getElementById('hidden-media-layout');
				samples.push({
					time,
					outerTop: readActiveTop(),
					hiddenTop: hidden.scrollTop,
				});
				if (samples.length < maxSamples) {
					sampleFrame = requestAnimationFrame(sample);
				} else {
					sampling = false;
					sampleFrame = 0;
				}
			};

			window.addEventListener('wheel', () => {
				const duration = stallBeforeNextWheelMs;
				stallBeforeNextWheelMs = 0;
				if (duration <= 0) return;
				const deadline = performance.now() + duration;
				while (performance.now() < deadline) {
					// Intentional test-only main-thread stall before HALO admission.
				}
			}, { capture: true, passive: true });

			// Bilibili-style global shortcut: the site owns arrows in bubble phase
			// even when focus is outside the player. HALO must stop this listener
			// only after it successfully admits page scrolling.
			window.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
				siteArrowKeys++;
				event.preventDefault();
			});

			window.__haloFixture = {
				installWheelProbe() {
					if (wheelProbeInstalled) return;
					wheelProbeInstalled = true;
					window.addEventListener('wheel', (event) => {
						lastWheelSampleIndex = samples.length;
						wheels.push({
							defaultPrevented: event.defaultPrevented,
							deltaY: event.deltaY,
							targetId: event.target instanceof Element ? event.target.id : '',
						});
					}, { passive: true });
				},
				reset(scrollerId) {
					sampling = false;
					if (sampleFrame) cancelAnimationFrame(sampleFrame);
					sampleFrame = 0;
					activeScrollerId = scrollerId;
					document.getElementById('fine-scroller').scrollTop = 0;
					document.getElementById('media-scroller').scrollTop = 0;
					document.getElementById('hidden-media-layout').scrollTop = 0;
					getShadowScroller().scrollTop = 0;
					window.scrollTo({ top: 0, behavior: 'instant' });
					samples = [];
					wheels = [];
					siteArrowKeys = 0;
					lastWheelSampleIndex = -1;
				},
				stallBeforeNextWheel(durationMs) {
					stallBeforeNextWheelMs = Math.max(0, durationMs);
				},
				startSampling() {
					if (sampling) return;
					sampling = true;
					sampleFrame = requestAnimationFrame(sample);
				},
				snapshot() {
					sampling = false;
					if (sampleFrame) cancelAnimationFrame(sampleFrame);
					sampleFrame = 0;
					return {
						fineTop: document.getElementById('fine-scroller').scrollTop,
						hiddenTop: document.getElementById('hidden-media-layout').scrollTop,
						lastWheelSampleIndex,
						outerTop: readActiveTop(),
						samples: samples.slice(),
						shadowTop: getShadowScroller().scrollTop,
						siteArrowKeys,
						wheels: wheels.slice(),
					};
				},
			};
		})();
	</script>
</body>
</html>`;

function distinctPositivePositions(samples: FrameSample[]): number[] {
	return Array.from(
		new Set(
			samples
				.map(({ outerTop }) => Math.round(outerTop * 100) / 100)
				.filter((position) => position > 0.01),
		),
	);
}

function expectGradualMovement(snapshot: FixtureSnapshot): void {
	const positions = distinctPositivePositions(snapshot.samples);
	expect(positions.length).toBeGreaterThanOrEqual(3);
	expect(positions.some((position) => position < snapshot.outerTop - 1)).toBe(true);
}

async function wheelAt(page: Page, selector: string, deltaY: number): Promise<void> {
	const box = await page.locator(selector).boundingBox();
	if (!box) throw new Error(`Wheel target is not visible: ${selector}`);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.evaluate(() => window.__haloFixture.startSampling());
	await page.mouse.wheel(0, deltaY);
}

// Wait for the next animation frame so layout settled by a synchronous reset
// (e.g. scrollTop = 0) is observable before the next wheel event is dispatched.
// Replaces fixed waitForTimeout(50/100) with an event-driven wait.
async function nextFrame(page: Page): Promise<void> {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);
}

async function waitForSmoothScrollAdmission(page: Page): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		await page.evaluate(() => window.__haloFixture.reset('fine-scroller'));
		await nextFrame(page);
		await wheelAt(page, '#fine-target', MICRO_WHEEL_DELTA);
		await nextFrame(page);
		const snapshot = await page.evaluate(() => window.__haloFixture.snapshot());
		if (snapshot.wheels.at(-1)?.defaultPrevented) {
			await waitForFinalPosition(page, 'fine-scroller', MICRO_WHEEL_DELTA);
			await page.evaluate(() => window.__haloFixture.reset('fine-scroller'));
			return;
		}
	}
	throw new Error('HALO content script did not admit a trusted wheel within 10 seconds');
}

async function waitForFinalPosition(
	page: Page,
	scrollerId: 'fine-scroller' | 'media-scroller' | 'shadow-scroller' | 'viewport',
	expected: number,
): Promise<void> {
	try {
		await page.waitForFunction(
			({ id, target, tolerance }) => {
				if (id === 'viewport') {
					return Math.abs(window.scrollY - target) <= tolerance;
				}
				if (id === 'shadow-scroller') {
					const shadowScroller = document
						.getElementById('shadow-host')
						?.shadowRoot
						?.getElementById('shadow-scroller');
					return shadowScroller !== null &&
						shadowScroller !== undefined &&
						Math.abs(shadowScroller.scrollTop - target) <= tolerance;
				}
				const scroller = document.getElementById(id);
				return scroller !== null && Math.abs(scroller.scrollTop - target) <= tolerance;
			},
			{ id: scrollerId, target: expected, tolerance: SETTLE_TOLERANCE },
			{ polling: 'raf', timeout: 2_500 },
		);
		// The fixture sampler is registered before HALO's animation callback.
		// Wait for the next presentation frame so it observes the final write
		// instead of snapshotting between the writer and the sampler.
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	} catch (error) {
		const snapshot = await page.evaluate(() => window.__haloFixture.snapshot());
		throw new Error(
			`Scroller ${scrollerId} did not reach ${expected}: ${JSON.stringify({
				hiddenTop: snapshot.hiddenTop,
				outerTop: snapshot.outerTop,
				positions: distinctPositivePositions(snapshot.samples),
				wheels: snapshot.wheels,
			})}`,
			{ cause: error },
		);
	}
}

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
		const onError = (error: Error) => reject(error);
		server.once('error', onError);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', onError);
			resolve();
		});
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
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

test.describe('HALO smooth scroll in Chromium', () => {
	test('owns wheel routes and keyboard media focus across real extension events', async () => {
		test.setTimeout(30_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-playwright-'));
		let server: Server | null = null;
		let fixtureUrl = '';
		let context: BrowserContext | null = null;

		try {
			({ server, url: fixtureUrl } = await startFixtureServer());
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

			const background = context.serviceWorkers()[0] ??
				await context.waitForEvent('serviceworker', { timeout: 10_000 });
			const extensionId = new URL(background.url()).host;
			const sidepanel = await context.newPage();
			const sidepanelErrors: string[] = [];
			sidepanel.on('pageerror', (error) => sidepanelErrors.push(error.message));
			await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
				waitUntil: 'load',
			});
			await expect(sidepanel.locator('[data-tool-id]').first()).toBeVisible({
				timeout: 10_000,
			});
			const storageRoundTrip = await sidepanel.evaluate(async () => {
				const filterKey = '__halo_test_media_filter_roundtrip__';
				const legacyKey = '__halo_test_media_filter_legacy_set__';
				try {
					await chrome.storage.local.set({
						[filterKey]: {
							types: ['video', 'audio'],
							minSize: 1024,
							includeDataUrls: true,
						},
						[legacyKey]: {
							types: new Set(['video', 'audio']),
							minSize: 0,
							includeDataUrls: false,
						},
					});
					const stored = await chrome.storage.local.get([filterKey, legacyKey]);
					return {
						filter: stored[filterKey],
						legacy: stored[legacyKey],
					};
				} finally {
					await chrome.storage.local.remove([filterKey, legacyKey]);
				}
			});
			expect(storageRoundTrip.filter).toEqual({
				types: ['video', 'audio'],
				minSize: 1024,
				includeDataUrls: true,
			});
			expect(storageRoundTrip.legacy).toEqual({
				types: {},
				minSize: 0,
				includeDataUrls: false,
			});
			const sidepanelSemantics = await sidepanel.evaluate(() => ({
				nestedButtons: document.querySelectorAll('button button').length,
				toolCount: document.querySelectorAll('[data-tool-id]').length,
				untypedButtons: document.querySelectorAll('button:not([type="button"])').length,
			}));
			expect(sidepanelErrors).toEqual([]);
			expect(sidepanelSemantics.nestedButtons).toBe(0);
			expect(sidepanelSemantics.toolCount).toBeGreaterThan(0);
			expect(sidepanelSemantics.untypedButtons).toBe(0);
			await sidepanel.close();

			const page = context.pages()[0] ?? await context.newPage();
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await page.goto(fixtureUrl, { waitUntil: 'load' });
			await page.evaluate(() => window.__haloFixture.installWheelProbe());
			await waitForSmoothScrollAdmission(page);

			expect(
				await page.evaluate(
					() => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
				),
			).toBe(true);

			await page.evaluate(() => window.__haloFixture.reset('fine-scroller'));
			const syntheticResult = await page.evaluate(() => {
				const target = document.getElementById('fine-target');
				if (!target) throw new Error('Synthetic wheel target is missing');
				const event = new WheelEvent('wheel', {
					bubbles: true,
					cancelable: true,
					composed: true,
					deltaY: 120,
				});
				const dispatched = target.dispatchEvent(event);
				return {
					defaultPrevented: event.defaultPrevented,
					dispatched,
					isTrusted: event.isTrusted,
				};
			});
			await nextFrame(page);
			const syntheticSnapshot = await page.evaluate(
				() => window.__haloFixture.snapshot(),
			);
			expect(syntheticResult).toEqual({
				defaultPrevented: false,
				dispatched: true,
				isTrusted: false,
			});
			expect(syntheticSnapshot.fineTop).toBe(0);

			await page.evaluate(() => {
				window.__haloFixture.reset('fine-scroller');
				window.__haloFixture.stallBeforeNextWheel(50);
			});
			await wheelAt(page, '#fine-target', 120);
			await waitForFinalPosition(
				page,
				'fine-scroller',
				COARSE_WHEEL_DISTANCE,
			);
			const stalledSnapshot = await page.evaluate(
				() => window.__haloFixture.snapshot(),
			);
			const stalledMovements = stalledSnapshot.samples.map(
				(sample, index, samples) =>
					sample.outerTop - (samples[index - 1]?.outerTop ?? 0),
			);
			const firstStalledMovement = stalledMovements.find(
				(movement) => movement > 0.01,
			);
			expect(firstStalledMovement).toBeDefined();
			expect(firstStalledMovement ?? Number.POSITIVE_INFINITY).toBeLessThan(60);
			expect(Math.max(...stalledMovements.map(Math.abs))).toBeLessThanOrEqual(100.01);
			expect(stalledSnapshot.outerTop).toBeCloseTo(COARSE_WHEEL_DISTANCE, 1);

			await page.evaluate(() => window.__haloFixture.reset('fine-scroller'));
			await nextFrame(page);
			await wheelAt(page, '#fine-target', MICRO_WHEEL_DELTA);
			await waitForFinalPosition(page, 'fine-scroller', MICRO_WHEEL_DELTA);

			const microSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			const firstVisibleMicroFrame = microSnapshot.samples
				.slice(microSnapshot.lastWheelSampleIndex)
				.findIndex(({ outerTop }) => outerTop > 0.01);
			expect(firstVisibleMicroFrame).toBeGreaterThanOrEqual(0);
			expect(firstVisibleMicroFrame).toBeLessThanOrEqual(4);

			await page.evaluate(() => window.__haloFixture.reset('fine-scroller'));
			await nextFrame(page);
			await wheelAt(page, '#fine-target', FINE_WHEEL_DELTA);
			await waitForFinalPosition(page, 'fine-scroller', FINE_WHEEL_DELTA);

			const fineSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			expect(Math.abs(fineSnapshot.outerTop - FINE_WHEEL_DELTA))
				.toBeLessThanOrEqual(SETTLE_TOLERANCE);
			expect(fineSnapshot.wheels).toEqual([
				{
					defaultPrevented: true,
					deltaY: FINE_WHEEL_DELTA,
					targetId: 'fine-target',
				},
			]);
			expectGradualMovement(fineSnapshot);

			await page.evaluate(() => window.__haloFixture.reset('shadow-scroller'));
			await nextFrame(page);
			await wheelAt(page, '#shadow-target', SHADOW_WHEEL_DELTA);
			await waitForFinalPosition(page, 'shadow-scroller', SHADOW_WHEEL_DELTA);

			const shadowSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			expect(Math.abs(shadowSnapshot.shadowTop - SHADOW_WHEEL_DELTA))
				.toBeLessThanOrEqual(SETTLE_TOLERANCE);
			expect(shadowSnapshot.fineTop).toBe(0);
			expect(shadowSnapshot.wheels).toEqual([
				{
					defaultPrevented: true,
					deltaY: SHADOW_WHEEL_DELTA,
					targetId: 'shadow-host',
				},
			]);
			expectGradualMovement(shadowSnapshot);

			await page.evaluate(() => window.__haloFixture.reset('shadow-scroller'));
			await nextFrame(page);
			await wheelAt(page, '#slotted-target', SLOT_WHEEL_DELTA);
			await waitForFinalPosition(page, 'shadow-scroller', SLOT_WHEEL_DELTA);

			const slotSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			expect(Math.abs(slotSnapshot.shadowTop - SLOT_WHEEL_DELTA))
				.toBeLessThanOrEqual(SETTLE_TOLERANCE);
			expect(slotSnapshot.fineTop).toBe(0);
			expect(slotSnapshot.wheels).toEqual([
				{
					defaultPrevented: true,
					deltaY: SLOT_WHEEL_DELTA,
					targetId: 'slotted-target',
				},
			]);
			expectGradualMovement(slotSnapshot);

			await page.evaluate(() => window.__haloFixture.reset('media-scroller'));
			await nextFrame(page);
			await wheelAt(page, '#video-target', MEDIA_WHEEL_DELTA);
			await waitForFinalPosition(page, 'media-scroller', MEDIA_WHEEL_DELTA);

			const mediaSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			expect(Math.abs(mediaSnapshot.outerTop - MEDIA_WHEEL_DELTA))
				.toBeLessThanOrEqual(SETTLE_TOLERANCE);
			expect(mediaSnapshot.hiddenTop).toBe(0);
			expect(mediaSnapshot.samples.every(({ hiddenTop }) => hiddenTop === 0)).toBe(true);
			expect(mediaSnapshot.wheels).toEqual([
				{
					defaultPrevented: true,
					deltaY: MEDIA_WHEEL_DELTA,
					targetId: 'video-target',
				},
			]);
			expectGradualMovement(mediaSnapshot);

			await page.evaluate(() => window.__haloFixture.reset('media-scroller'));
			await page.locator('#page-focus').click();
			expect(
				await page.evaluate(() => document.activeElement?.id),
			).toBe('page-focus');
			await page.keyboard.press('ArrowDown');
			await waitForFinalPosition(
				page,
				'media-scroller',
				COARSE_WHEEL_DISTANCE,
			);
			const pageArrowSnapshot = await page.evaluate(
				() => window.__haloFixture.snapshot(),
			);
			expect(pageArrowSnapshot.siteArrowKeys).toBe(0);

			await page.evaluate(() => window.__haloFixture.reset('media-scroller'));
			await page.locator('#video-target').click();
			await page.keyboard.press('ArrowDown');
			await nextFrame(page);
			const mediaArrowSnapshot = await page.evaluate(
				() => window.__haloFixture.snapshot(),
			);
			expect(mediaArrowSnapshot.outerTop).toBe(0);
			expect(mediaArrowSnapshot.siteArrowKeys).toBe(1);

			await page.evaluate(() => {
				document.documentElement.style.height = 'auto';
				document.documentElement.style.overflow = 'auto';
				document.documentElement.style.scrollBehavior = 'smooth';
				Object.assign(document.body.style, {
					display: 'block',
					height: 'auto',
					overflow: 'visible',
					padding: '0',
				});
				document.getElementById('fine-scroller')?.style.setProperty('display', 'none');
				document.getElementById('media-scroller')?.style.setProperty('display', 'none');
				const target = document.createElement('div');
				target.id = 'viewport-target';
				target.className = 'hit';
				target.textContent = 'Viewport wheel target';
				const filler = document.createElement('div');
				filler.className = 'filler';
				document.body.append(target, filler);
				window.__haloFixture.reset('viewport');
	});
			await nextFrame(page);
			await wheelAt(page, '#viewport-target', VIEWPORT_WHEEL_DELTA);
			await waitForFinalPosition(page, 'viewport', VIEWPORT_WHEEL_DELTA);

			const viewportSnapshot = await page.evaluate(() => window.__haloFixture.snapshot());
			expect(Math.abs(viewportSnapshot.outerTop - VIEWPORT_WHEEL_DELTA))
				.toBeLessThanOrEqual(SETTLE_TOLERANCE);
			expect(viewportSnapshot.wheels).toEqual([
				{
					defaultPrevented: true,
					deltaY: VIEWPORT_WHEEL_DELTA,
					targetId: 'viewport-target',
				},
			]);
			expectGradualMovement(viewportSnapshot);
		} finally {
			try {
				await context?.close();
			} finally {
				try {
					await closeFixtureServer(server);
				} finally {
					await rm(profilePath, {
						recursive: true,
						force: true,
						maxRetries: 5,
						retryDelay: 100,
					});
				}
			}
		}
	});
});
