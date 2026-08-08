import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromium,
	expect,
	test,
	type BrowserContext,
	type Page,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

function isSidepanelLazyChunk(url: string): boolean {
	return url.startsWith('chrome-extension://') && url.includes('/chunks/') && url.endsWith('.js');
}

async function portalTextExistsOutsideRoot(page: Page, text: string): Promise<boolean> {
	return page.evaluate((expected) => Array.from(document.body.children).some((element) => (
		element.id !== 'root' && element.textContent?.trim() === expected
	)), text);
}

test.describe('HALO SidePanel runtime in Chromium', () => {
	test('preserves home, hover preload, controlled state, lazy tools and portals', async () => {
		test.setTimeout(40_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-sidepanel-runtime-'));
		let context: BrowserContext | null = null;

		try {
			context = await chromium.launchPersistentContext(profilePath, {
				channel: 'chromium',
				headless: true,
				viewport: { width: 520, height: 760 },
				args: [
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});

			const browserErrors: string[] = [];
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			const worker = await extensionWorker(context);
			const extensionId = new URL(worker.url()).hostname;
			const page = await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});

			await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
			await expect(page.locator('#root > *')).toBeVisible();

			// Controlled input + global keyboard effect/event ownership.
			const search = page.locator('input[type="text"]').first();
			await expect(search).toBeVisible();
			await page.keyboard.press('Control+k');
			await expect(search).toBeFocused();
			await search.fill('zzzz-no-match');
			await expect(search).toHaveValue('zzzz-no-match');
			await page.keyboard.press('Escape');
			await expect(search).toHaveValue('');

			const hashTool = page.locator('button[data-tool-id="hash"]');
			await expect(hashTool).toBeVisible();

			// Hover preload must cross a real production lazy-chunk boundary before
			// selection. This proves HALO no longer relies on React.lazy private fields.
			const preloadFinished = context.waitForEvent('requestfinished', {
				predicate: (request) => isSidepanelLazyChunk(request.url()),
				timeout: 10_000,
			});
			await hashTool.hover();
			await preloadFinished;

			// Selection still crosses LauncherToolPage lazy/Suspense while the panel
			// module itself is already owned by the memoized generated loader.
			await hashTool.click();
			const hashInput = page.locator('textarea').first();
			await expect(hashInput).toBeVisible();
			await hashInput.fill('preact-compat-proof');
			await expect(hashInput).toHaveValue('preact-compat-proof');

			// Dock uses createPortal() for its delayed tooltip. Prove the portal is
			// physically mounted under body rather than inside the React root.
			const dockItem = page.locator('[data-dock-item]').first();
			await expect(dockItem).toBeVisible();
			const dockLabel = await dockItem.locator('button').first().getAttribute('aria-label');
			expect(dockLabel).toBeTruthy();
			await dockItem.hover();
			await expect.poll(
				() => portalTextExistsOutsideRoot(page, dockLabel ?? ''),
				{ timeout: 5_000 },
			).toBe(true);

			// Closing the only dock item must retire the tool page and restore Home.
			await dockItem.locator('button').nth(1).click();
			await expect(page.locator('[data-dock-item]')).toHaveCount(0);
			await page.keyboard.press('Control+k');
			await expect(search).toBeFocused();

			expect(browserErrors).toEqual([]);
		} finally {
			await context?.close();
			await rm(profilePath, {
				force: true,
				recursive: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		}
	});
});
