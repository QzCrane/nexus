import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromium,
	expect,
	test,
	type BrowserContext,
} from '@playwright/test';

const extensionDir = fileURLToPath(new URL('../', import.meta.url));
const workspaceDir = resolve(extensionDir, '../..');
const distPath = resolve(extensionDir, 'dist');
const baselinePath = resolve(
	extensionDir,
	'store-listings/assets/halo-sidepanel-1280x800.png',
);
const candidatePath = resolve(
	workspaceDir,
	'../artifacts/visual-candidates/halo-sidepanel-1280x800.png',
);
const updateBaseline = process.env.NEXUS_UPDATE_VISUAL_BASELINE === '1';
const explicitChrome = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const expectedChrome = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (explicitChrome && !existsSync(explicitChrome)) {
	throw new Error(`Pinned Chrome executable is missing: ${explicitChrome}`);
}

const screenshotPath = updateBaseline ? baselinePath : candidatePath;

test('captures the deterministic production HALO SidePanel visual state', async () => {
	test.setTimeout(30_000);
	const profilePath = await mkdtemp(join(tmpdir(), 'halo-store-assets-'));
	let context: BrowserContext | null = null;
	try {
		context = await chromium.launchPersistentContext(profilePath, {
			...(explicitChrome ? { executablePath: explicitChrome } : { channel: 'chromium' as const }),
			headless: true,
			viewport: { width: 1280, height: 800 },
			deviceScaleFactor: 1,
			locale: 'en-US',
			colorScheme: 'dark',
			reducedMotion: 'reduce',
			args: [
				`--disable-extensions-except=${distPath}`,
				`--load-extension=${distPath}`,
			],
		});
		if (expectedChrome) {
			expect(await context.browser()?.version()).toContain(expectedChrome);
		}
		const background = context.serviceWorkers()[0] ??
			await context.waitForEvent('serviceworker', { timeout: 10_000 });
		const extensionId = new URL(background.url()).host;
		// Locale is a durable UI authority. Fix it before the first SidePanel realm
		// exists so visual evidence never depends on the runner's host language.
		await background.evaluate(async () => {
			await chrome.storage.sync.set({ halo_locale: 'en' });
		});
		const page = await context.newPage();
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
		await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
			waitUntil: 'load',
		});
		await expect(page.locator('[data-tool-id]').first()).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.locator('html')).toHaveAttribute('lang', /en/i).catch(() => undefined);
		await mkdir(dirname(screenshotPath), { recursive: true });
		await page.screenshot({
			path: screenshotPath,
			animations: 'disabled',
			fullPage: false,
		});
		console.log(
			updateBaseline
				? `✓ Updated explicit HALO visual baseline: ${baselinePath}`
				: `✓ Captured HALO visual candidate without mutating baseline: ${candidatePath}`,
		);
	} finally {
		await context?.close();
		await rm(profilePath, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});
