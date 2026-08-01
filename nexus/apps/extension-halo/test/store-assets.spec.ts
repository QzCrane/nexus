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
const distPath = resolve(extensionDir, 'dist');
const screenshotPath = resolve(
	extensionDir,
	'store-listings/assets/halo-sidepanel-1280x800.png',
);

test('captures the production HALO SidePanel listing asset', async () => {
	test.setTimeout(30_000);
	const profilePath = await mkdtemp(join(tmpdir(), 'halo-store-assets-'));
	let context: BrowserContext | null = null;
	try {
		context = await chromium.launchPersistentContext(profilePath, {
			channel: 'chromium',
			headless: true,
			viewport: { width: 1280, height: 800 },
			args: [
				`--disable-extensions-except=${distPath}`,
				`--load-extension=${distPath}`,
			],
		});
		const background = context.serviceWorkers()[0] ??
			await context.waitForEvent('serviceworker', { timeout: 10_000 });
		const extensionId = new URL(background.url()).host;
		const page = await context.newPage();
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
		await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
			waitUntil: 'load',
		});
		await expect(page.locator('[data-tool-id]').first()).toBeVisible({
			timeout: 10_000,
		});
		await mkdir(dirname(screenshotPath), { recursive: true });
		await page.screenshot({
			path: screenshotPath,
			animations: 'disabled',
			fullPage: false,
		});
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
