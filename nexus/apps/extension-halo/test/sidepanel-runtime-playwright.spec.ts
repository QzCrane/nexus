import { extensionWorker } from './helpers/extension-worker';
import { browserReplayPolicy } from '../../../scripts/browser-replay';
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
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();

function isSidepanelLazyChunk(url: string): boolean {
	return url.startsWith('chrome-extension://') && url.includes('/chunks/') && url.endsWith('.js');
}

async function portalTextExistsOutsideRoot(page: Page, text: string): Promise<boolean> {
	return page.evaluate((expected) => Array.from(document.body.children).some((element) => (
		element.id !== 'root' && element.textContent?.trim() === expected
	)), text);
}

async function dispatchGlobalSearchShortcut(page: Page): Promise<void> {
	// A standalone extension tab lets Chromium reserve Ctrl+K for the omnibox,
	// while the real SidePanel surface delivers the event to its document. Drive
	// the document listener directly here; native key ownership has its own
	// installed-extension contract and must not make this renderer gate flaky.
	await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
		key: 'k',
		ctrlKey: true,
		bubbles: true,
		cancelable: true,
	})));
}

test.describe('HALO SidePanel runtime in Chromium', () => {
	test('preserves home, hover preload, controlled state, lazy tools and portals', async () => {
		test.setTimeout(40_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-sidepanel-runtime-'));
		let context: BrowserContext | null = null;

		try {
			context = await chromium.launchPersistentContext(profilePath, {
				...(EXPLICIT_CHROME
					? { executablePath: EXPLICIT_CHROME }
					: { channel: 'chromium' as const }),
				headless: true,
				viewport: { width: 520, height: 760 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});

			const browserErrors: string[] = [];
			const lazyChunkUrls = new Set<string>();
			context.on('weberror', (error) => browserErrors.push(String(error.error())));
			context.on('requestfinished', (request) => {
				if (isSidepanelLazyChunk(request.url())) lazyChunkUrls.add(request.url());
			});
			const worker = await extensionWorker(context);
			const extensionId = new URL(worker.url()).hostname;
			const page = await context.newPage();
			page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') browserErrors.push(message.text());
			});

			await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });

			// Controlled input + global keyboard effect/event ownership.
			const search = page.locator('input[type="text"]').first();
			await expect(search).toBeVisible();
			await dispatchGlobalSearchShortcut(page);
			await expect(search).toBeFocused();
			await search.fill('zzzz-no-match');
			await expect(search).toHaveValue('zzzz-no-match');
			await page.keyboard.press('Escape');
			await expect(search).toHaveValue('');

			const jsonTool = page.locator('button[data-tool-id="json-formatter"]');
			await expect(jsonTool).toBeVisible();
			await expect(jsonTool).toBeEnabled();

			// Ignore any startup chunk traffic. Every URL below this point must be
			// caused by the explicit hover/click interactions under test.
			lazyChunkUrls.clear();

			// Hover preload must cross a real production panel-chunk boundary before
			// selection. This proves HALO no longer relies on React.lazy private fields.
			await jsonTool.hover();
			await expect.poll(() => lazyChunkUrls.size, { timeout: 10_000 }).toBeGreaterThan(0);
			const preloadedChunkUrls = new Set(lazyChunkUrls);

			// Selection must still cross a distinct LauncherToolPage lazy/Suspense
			// boundary while the admitted JSON Formatter panel is already owned by
			// the memoized loader.
			await jsonTool.click();
			await expect.poll(
				() => [...lazyChunkUrls].filter((url) => !preloadedChunkUrls.has(url)).length,
				{ timeout: 10_000 },
			).toBeGreaterThan(0);
			const jsonInput = page.locator('textarea').first();
			await expect(jsonInput).toBeVisible();
			await jsonInput.fill('{"release":"admitted"}');
			await expect(jsonInput).toHaveValue('{"release":"admitted"}');

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
			await dispatchGlobalSearchShortcut(page);
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
