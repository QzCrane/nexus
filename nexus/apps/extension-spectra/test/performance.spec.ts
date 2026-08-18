import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import {
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const SAMPLE_COUNT = 20;

async function extensionId(browser: Browser): Promise<string> {
	const target = await browser.waitForTarget(
		(candidate) => candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
		{ timeout: 10_000 },
	);
	return new URL(target.url()).hostname;
}

test('records twenty independent SPECTRA Popup cold-interactive samples', async () => {
	const samples: RuntimePerformanceSample[] = [];
	let observedBrowserVersion = '';

	for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
		const profilePath = await mkdtemp(join(tmpdir(), 'spectra-popup-perf-'));
		let browser: Browser | null = null;
		try {
			const coldStarted = performance.now();
			browser = await puppeteer.launch({
				headless: true,
				userDataDir: profilePath,
				args: [
					`--disable-extensions-except=${EXTENSION_DIR}`,
					`--load-extension=${EXTENSION_DIR}`,
				],
			});
			const id = await extensionId(browser);
			const page = await browser.newPage();
			const navigationStarted = performance.now();
			await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
			await page.waitForSelector('html[data-spectra-ready="true"]', { timeout: 10_000 });
			const interactiveAt = performance.now();
			samples.push({
				metric: 'spectra.popup.cold-profile-to-interactive',
				value: interactiveAt - coldStarted,
				unit: 'ms',
			});
			samples.push({
				metric: 'spectra.popup.navigation-to-interactive',
				value: interactiveAt - navigationStarted,
				unit: 'ms',
			});
			if (!observedBrowserVersion) observedBrowserVersion = await browser.version();
		} finally {
			await browser?.close();
			await rm(profilePath, {
				force: true,
				recursive: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		}
	}

	expect(samples).toHaveLength(SAMPLE_COUNT * 2);
	writeRuntimePerformanceEvidence({
		product: 'spectra',
		browser: { name: 'Chrome', version: observedBrowserVersion || 'unknown' },
		samples,
	});
}, 180_000);
