import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test, type BrowserContext, type Worker } from '@playwright/test';
import {
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const SAMPLE_COUNT = 20;

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

function chromeVersion(userAgent: string): string {
	return /(?:HeadlessChrome|Chrome)\/([0-9.]+)/u.exec(userAgent)?.[1] ?? userAgent;
}

test.describe('HALO runtime performance evidence', () => {
	test('records twenty independent SidePanel cold-interactive samples', async () => {
		test.setTimeout(180_000);
		const samples: RuntimePerformanceSample[] = [];
		let observedBrowserVersion = '';

		for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
			const profilePath = await mkdtemp(join(tmpdir(), 'halo-sidepanel-perf-'));
			let context: BrowserContext | null = null;
			try {
				const coldStarted = performance.now();
				context = await chromium.launchPersistentContext(profilePath, {
					channel: 'chromium',
					headless: true,
					viewport: { width: 520, height: 760 },
					args: [
						`--disable-extensions-except=${DIST_PATH}`,
						`--load-extension=${DIST_PATH}`,
					],
				});
				const worker = await extensionWorker(context);
				const extensionId = new URL(worker.url()).hostname;
				const page = await context.newPage();
				const navigationStarted = performance.now();
				await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
				await page.locator('button[data-tool-id="hash"]').waitFor({ state: 'visible', timeout: 10_000 });
				const interactiveAt = performance.now();
				samples.push({
					metric: 'halo.sidepanel.cold-profile-to-interactive',
					value: interactiveAt - coldStarted,
					unit: 'ms',
				});
				samples.push({
					metric: 'halo.sidepanel.navigation-to-interactive',
					value: interactiveAt - navigationStarted,
					unit: 'ms',
				});
				if (!observedBrowserVersion) {
					observedBrowserVersion = chromeVersion(await page.evaluate(() => navigator.userAgent));
				}
			} finally {
				await context?.close();
				await rm(profilePath, {
					force: true,
					recursive: true,
					maxRetries: 3,
					retryDelay: 100,
				});
			}
		}

		writeRuntimePerformanceEvidence({
			product: 'halo',
			browser: { name: 'Chromium', version: observedBrowserVersion || 'unknown' },
			samples,
		});
	});
});
