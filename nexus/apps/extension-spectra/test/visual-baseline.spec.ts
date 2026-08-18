import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import puppeteer, { type Browser, type Target } from 'puppeteer';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const workspaceDir = resolve(EXTENSION_DIR, '../../..');
const baselinePath = resolve(EXTENSION_DIR, '../store-listings/assets/spectra-popup-empty-390x600.png');
const candidatePath = resolve(workspaceDir, '../artifacts/visual-candidates/spectra-popup-empty-390x600.png');
const updateBaseline = process.env.NEXUS_UPDATE_VISUAL_BASELINE === '1';
const explicitChrome = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const expectedChrome = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (explicitChrome && !existsSync(explicitChrome)) {
	throw new Error(`Pinned Chrome executable is missing: ${explicitChrome}`);
}
if (updateBaseline && !explicitChrome) {
	throw new Error('SPECTRA visual baseline update requires NEXUS_CHROME_EXECUTABLE');
}

const screenshotPath = updateBaseline ? baselinePath : candidatePath;

test('captures the deterministic SPECTRA empty Popup visual state', async () => {
	const profileDir = await mkdtemp(join(tmpdir(), 'spectra-visual-'));
	let browser: Browser | null = null;
	try {
		browser = await puppeteer.launch({
			...(explicitChrome ? { executablePath: explicitChrome } : {}),
			headless: true,
			userDataDir: profileDir,
			defaultViewport: { width: 390, height: 600, deviceScaleFactor: 1 },
			args: [
				`--disable-extensions-except=${EXTENSION_DIR}`,
				`--load-extension=${EXTENSION_DIR}`,
				'--lang=en-US',
				'--no-sandbox',
				'--disable-setuid-sandbox',
			],
		});
		const browserVersion = await browser.version();
		if (expectedChrome) expect(browserVersion).toContain(expectedChrome);
		const workerTarget: Target = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
		const extensionId = new URL(workerTarget.url()).host;
		const page = await browser.newPage();
		await page.setViewport({ width: 390, height: 600, deviceScaleFactor: 1 });
		await page.emulateMediaFeatures([
			{ name: 'prefers-color-scheme', value: 'dark' },
			{ name: 'prefers-reduced-motion', value: 'reduce' },
		]);
		await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => document.documentElement.dataset.spectraReady === 'true',
			{ timeout: 10_000 },
		);
		await page.waitForSelector('#empty-state:not(.hidden)', { timeout: 10_000 });
		await page.evaluate(() => {
			for (const element of document.querySelectorAll<HTMLElement>('*')) {
				element.style.setProperty('animation', 'none', 'important');
				element.style.setProperty('transition', 'none', 'important');
			}
		});
		const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
		mkdirSync(dirname(screenshotPath), { recursive: true });
		writeFileSync(screenshotPath, png);
		console.log(
			updateBaseline
				? `✓ Updated explicit SPECTRA visual baseline: ${baselinePath}`
				: `✓ Captured SPECTRA visual candidate without mutating baseline: ${candidatePath}`,
		);
	} finally {
		await browser?.close().catch(() => undefined);
		await rm(profileDir, {
			force: true,
			recursive: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
}, 60_000);
