import { extensionWorker } from './helpers/extension-worker';
import { browserReplayPolicy } from '../../../scripts/browser-replay';
import { launchPlaywrightPersistentContext } from '../../../scripts/browser-driver';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();

function launchHalo(profilePath: string) {
	return launchPlaywrightPersistentContext(chromium, profilePath, {
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
		headless: true,
		viewport: { width: 520, height: 760 },
		args: [
			...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
			`--disable-extensions-except=${DIST_PATH}`,
			`--load-extension=${DIST_PATH}`,
		],
	}, {
		owner: 'apps/extension-halo/test/heavy-task-lifecycle-playwright.spec.ts',
		profile: { kind: 'temporary', prefix: 'halo-heavy-task-', isolated: true },
	});
}

test.describe('HALO heavy task lifecycle in installed Chromium', () => {
	let context: BrowserContext;
	let profilePath: string;

	test.beforeEach(async () => {
		profilePath = await mkdtemp(join(tmpdir(), 'halo-heavy-task-'));
		context = await launchHalo(profilePath);
	});

	test.afterEach(async () => {
		await context.close();
		await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
	});

	test('terminates a timed-out regex worker, supersedes it rapidly, and cancels on panel unmount', async () => {
		test.setTimeout(30_000);
		const background = await extensionWorker(context);
		const page = await context.newPage();
		const browserErrors: string[] = [];
		context.on('weberror', (error) => browserErrors.push(String(error.error())));
		await page.goto(`chrome-extension://${new URL(background.url()).hostname}/sidepanel.html`);
		await page.locator('button[data-tool-id="regex"]').click();
		// The SidePanel launcher keeps a global "Search tools..." input above the
		// tool host; a generic `input.first()` selects that search box instead of
		// the regex pattern field, so the pattern is matched by its placeholder.
		const pattern = page.locator('input[placeholder*="regex pattern" i], input[placeholder*="正则" i]').first();
		const input = page.locator('textarea').first();
		const catastrophicText = `${'a'.repeat(80_000)}!`;

		await pattern.fill('(a+)+$');
		await input.fill(catastrophicText);
		await expect(page.getByText('Task deadline exceeded')).toBeVisible({ timeout: 5_000 });
		await pattern.fill('a+');
		await input.fill('aaa');
		await expect(page.getByText('Task deadline exceeded')).toHaveCount(0);
		await expect(page.getByText('"aaa"', { exact: true })).toBeVisible();

		await pattern.fill('(a+)+$');
		await input.fill(catastrophicText);
		await page.waitForTimeout(250);
		// While a tool is open the launcher page is translated offscreen, so the
		// real user flow back to the tool grid is the banner Back button; then a
		// different tool supersedes the still-running regex task.
		await page.locator('button[title="Back"], button[title="返回"]').click();
		await page.locator('button[data-tool-id="json-formatter"]').click();
		await page.waitForTimeout(2_250);
		expect(browserErrors).toEqual([]);
	});

	test('downloads MHTML to the filesystem and opens it in a main-frame tab after the SidePanel closes', async () => {
		const background = await extensionWorker(context);
		const extensionId = new URL(background.url()).hostname;
		const owner = await context.newPage();
		await owner.goto(`chrome-extension://${extensionId}/sidepanel.html`);
		const downloadEvent = owner.waitForEvent('download');
		await owner.evaluate(() => {
			const source = [
				'From: <Saved by HALO>',
				'MIME-Version: 1.0',
				'Content-Type: multipart/related; boundary="halo-boundary"',
				'',
				'--halo-boundary',
				'Content-Type: text/html; charset="utf-8"',
				'Content-Location: https://halo.invalid/archive',
				'',
				'<!doctype html><title>HALO MHTML lifecycle</title><a id="jump" href="#after">Jump</a><h1 id="proof">Archive view retained</h1><p id="after">Still interactive</p>',
				'--halo-boundary--',
			].join('\r\n');
			const url = URL.createObjectURL(new Blob([source], { type: 'multipart/related' }));
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'halo-lifecycle.mhtml';
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1_000);
		});
		const download = await downloadEvent;
		expect(download.suggestedFilename()).toBe('halo-lifecycle.mhtml');
		// Chrome maps a file:// URL's MIME type from its extension, so the
		// downloaded payload must keep the .mhtml extension to be parsed as
		// multipart/related instead of falling back to text/plain.
		const mhtmlPath = join(profilePath, 'halo-lifecycle.mhtml');
		await download.saveAs(mhtmlPath);
		await owner.close();
		const viewer = await context.newPage();
		await viewer.goto(pathToFileURL(mhtmlPath).href);
		await expect(viewer.locator('#proof')).toHaveText('Archive view retained');
		await viewer.reload();
		await expect(viewer.locator('#after')).toHaveText('Still interactive');
	});
});
