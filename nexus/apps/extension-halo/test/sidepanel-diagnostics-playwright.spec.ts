import { browserReplayPolicy } from '../../../scripts/browser-replay';
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromium,
	expect,
	test,
	type BrowserContext,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

test.describe('HALO local diagnostic export privacy', () => {
	test('exports manifest/browser/runtime counts without page URL/title/content', async () => {
		test.setTimeout(45_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-diagnostics-'));
		let context: BrowserContext | null = null;
		try {
			context = await chromium.launchPersistentContext(profilePath, {
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
				headless: true,
				viewport: { width: 360, height: 720 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});
			const worker = await extensionWorker(context);
			const extensionId = new URL(worker.url()).hostname;
			const privatePage = await context.newPage();
			await privatePage.goto(
				'data:text/html,%3Ctitle%3EHALO_PRIVATE_DIAGNOSTIC_TITLE%3C%2Ftitle%3E%3Cbody%3EHALO_PRIVATE_DIAGNOSTIC_BODY_PRIVATE_TOKEN_123%3C%2Fbody%3E',
				{ waitUntil: 'load' },
			);

			const page = await context.newPage();
			await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
			const settings = page.locator('button[data-tool-id="settings"]');
			await expect(settings).toBeVisible();
			await settings.click();
			const exportButton = page.getByRole('button', { name: /Export diagnostic JSON/i });
			await expect(exportButton).toBeVisible();
			await expect(exportButton).toBeEnabled();

			await page.evaluate(() => {
				const scope = window as Window & { __haloDiagnosticJson?: string };
				URL.createObjectURL = ((blob: Blob) => {
					void blob.text().then((text) => { scope.__haloDiagnosticJson = text; });
					return 'blob:halo-diagnostic-test';
				}) as typeof URL.createObjectURL;
				HTMLAnchorElement.prototype.click = function click(): void {
					// Test-only: capture the local Blob without navigating/downloading.
				};
			});
			await exportButton.click();
			await page.waitForFunction(
				() => typeof (window as Window & { __haloDiagnosticJson?: string }).__haloDiagnosticJson === 'string',
				undefined,
				{ timeout: 10_000 },
			);
			const json = await page.evaluate(() => (
				(window as Window & { __haloDiagnosticJson?: string }).__haloDiagnosticJson ?? ''
			));
			const bundle = JSON.parse(json) as {
				product?: string;
				manifestVersion?: string;
				origins?: { grantCount?: number; broadGrant?: boolean };
				owners?: Record<string, boolean | number | null>;
				contexts?: Record<string, number>;
			};
			expect(bundle.product).toBe('HALO');
			expect(bundle.manifestVersion).toMatch(/^\d+\.\d+\.\d+$/u);
			expect(typeof bundle.origins?.grantCount).toBe('number');
			expect(typeof bundle.origins?.broadGrant).toBe('boolean');
			expect(typeof bundle.owners?.activeServiceCount).toBe('number');
			expect(typeof bundle.owners?.backgroundMechanismCount).toBe('number');
			expect(Object.keys(bundle.contexts ?? {}).length).toBeGreaterThan(0);

			expect(json).not.toContain('HALO_PRIVATE_DIAGNOSTIC_TITLE');
			expect(json).not.toContain('HALO_PRIVATE_DIAGNOSTIC_BODY');
			expect(json).not.toContain('PRIVATE_TOKEN_123');
			expect(json).not.toContain('data:text/html');
			await expect(page.getByText(`HALO v${bundle.manifestVersion}`, { exact: false })).toBeVisible();
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
