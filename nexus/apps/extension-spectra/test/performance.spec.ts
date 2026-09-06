import { launchBrowser } from './helpers/browser-driver';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import type { Browser } from 'puppeteer';
import {
	runtimePerformanceIdentityFromEnvironment,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const SAMPLE_COUNT = 20;
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME_VERSION = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

async function extensionId(browser: Browser): Promise<string> {
	try {
		const target = await browser.waitForTarget(
			(candidate) => candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
			{ timeout: 10_000 },
		);
		return new URL(target.url()).hostname;
	} catch (cause) {
		const targets = browser.targets().map((target) => ({ type: target.type(), url: target.url() }));
		throw new Error(`Cold profile did not expose its extension worker: ${JSON.stringify({ extensionDir: EXTENSION_DIR, targets })}`, { cause });
	}
}

test('records twenty independent SPECTRA Popup cold-interactive samples', async () => {
	const samples: RuntimePerformanceSample[] = [];
	let observedBrowserVersion = '';

	for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
		const profilePath = await mkdtemp(join(tmpdir(), 'spectra-popup-perf-'));
		let browser: Browser | null = null;
		try {
			const coldStarted = performance.now();
			browser = await launchBrowser({
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
				headless: true,
				userDataDir: profilePath,
				args: [
					`--disable-extensions-except=${EXTENSION_DIR}`,
					`--load-extension=${EXTENSION_DIR}`,
				],
			});
			const currentBrowserVersion = await browser.version();
			if (EXPECTED_CHROME_VERSION && !currentBrowserVersion.includes(EXPECTED_CHROME_VERSION)) {
				throw new Error(`Expected Chrome ${EXPECTED_CHROME_VERSION}, got ${currentBrowserVersion}`);
			}
			const id = await extensionId(browser);
			const page = await browser.newPage();
			const navigationStarted = performance.now();
			await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
			// Observe the same user-facing readiness in both builds. The candidate's
			// private ready marker is absent from the frozen base and cannot be a
			// common benchmark oracle. Verify settings data and real navigation.
			await page.waitForFunction(() => {
				const settings = document.getElementById('btn-settings');
				return document.documentElement.lang.length > 0
					&& settings instanceof HTMLElement && typeof settings.onclick === 'function'
					&& typeof document.querySelector<HTMLInputElement>('#set-osd')?.onchange === 'function'
					&& document.getElementById('bg-badge')?.textContent?.trim() === '0'
					&& !document.getElementById('empty-state')?.classList.contains('hidden');
			}, { timeout: 10_000 });
			await page.click('#btn-settings');
			await page.waitForSelector('#view-settings.active', { visible: true, timeout: 10_000 });
			await page.click('#btn-back');
			await page.waitForSelector('#view-main.active', { visible: true, timeout: 10_000 });
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
			if (!observedBrowserVersion) observedBrowserVersion = currentBrowserVersion;
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
		identity: runtimePerformanceIdentityFromEnvironment(),
	});
}, 180_000);
