import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { browserReplayPolicy } from '../../../scripts/browser-replay';
import { launchPlaywrightPersistentContext } from '../../../scripts/browser-driver';
import { extensionWorker } from './helpers/extension-worker';

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
		owner: 'apps/extension-halo/test/semantic-tools-playwright.spec.ts',
		profile: { kind: 'temporary', prefix: 'halo-semantic-tools-', isolated: true },
	});
}

test.describe('HALO semantic tools in the production extension', () => {
	let context: BrowserContext;
	let profilePath: string;

	test.beforeEach(async () => {
		profilePath = await mkdtemp(join(tmpdir(), 'halo-semantic-tools-'));
		context = await launchHalo(profilePath);
	});

	test.afterEach(async () => {
		await context.close();
		await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
	});

	test('shows RFC JSONPath syntax failures and excludes inherited constructor properties', async () => {
		const background = await extensionWorker(context);
		const page = await context.newPage();
		const browserErrors: string[] = [];
		context.on('weberror', (error) => browserErrors.push(String(error.error())));
		await page.goto(`chrome-extension://${new URL(background.url()).hostname}/sidepanel.html`);
		await page.locator('button[data-tool-id="json-path"]').click();
		await page.locator('textarea').fill('{"nested":{"x":2},"x":1}');
		const query = page.locator('input[placeholder="$.users[*].name"]');
		await query.fill('$[');
		await expect(page.getByText(/Invalid JSONPath|无效的 JSONPath/)).toBeVisible();
		await query.fill('$.constructor');
		await expect(page.locator('pre')).toHaveText('[]');
		await expect(page.getByText(/Valid query with no matches|查询有效，但没有匹配项/)).toBeVisible();
		expect(browserErrors).toEqual([]);
	});

	test('renders report-only disposition, duplicate first-wins, and multi-policy intersection', async () => {
		const background = await extensionWorker(context);
		const page = await context.newPage();
		const browserErrors: string[] = [];
		context.on('weberror', (error) => browserErrors.push(String(error.error())));
		await page.goto(`chrome-extension://${new URL(background.url()).hostname}/sidepanel.html`);
		await page.locator('button[data-tool-id="csp-analyzer"]').click();
		await page.locator('#csp-enforced').fill("script-src 'self'; script-src *; object-src 'none'\ndefault-src 'none'");
		await page.locator('#csp-report-only').fill("default-src 'self'");
		await expect(page.getByText(/Enforced policy present|存在强制执行的策略/)).toBeVisible();
		await expect(page.getByText(/Multiple enforced policies all apply|多个强制策略会同时生效/)).toBeVisible();
		await expect(page.getByText(/Later duplicate directives are ignored: script-src|后续同名指令会被忽略: script-src/)).toBeVisible();
		await expect(page.getByText(/Report only · Policy 3|仅报告 · 策略 3/)).toBeVisible();
		expect(browserErrors).toEqual([]);
	});
});
