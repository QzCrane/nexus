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
		owner: 'apps/extension-halo/test/storage-recovery-playwright.spec.ts',
		profile: { kind: 'temporary', prefix: 'halo-storage-recovery-', isolated: true },
	});
}

test.describe('HALO storage recovery in installed Chromium', () => {
	test('preserves invalid data until explicit replacement', async () => {
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-storage-recovery-'));
		let context: BrowserContext | null = null;
		const key = 'halo_tool_state_diff';
		const damaged = { text1: 'keep this text', text2: 7 };
		try {
			const launched = await launchHalo(profilePath);
			context = launched;
			const worker = await extensionWorker(launched);
			await worker.evaluate(async ({ key, damaged }) => chrome.storage.local.set({ [key]: damaged, [`${key}#rev`]: 4 }), { key, damaged });
			const page = await launched.newPage();
			await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
			await page.locator('button[data-tool-id="diff"]').click();
			await expect(page.getByText('Stored data is damaged or from an unsupported version. It was left unchanged.')).toBeVisible();
			expect(await worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key)).toEqual(damaged);
			await page.getByRole('button', { name: 'Replace with empty data' }).click();
			await expect.poll(() => worker.evaluate(async (key) => chrome.storage.local.get([key, `${key}#rev`]), key))
				.toEqual({ [key]: { text1: '', text2: '' }, [`${key}#rev`]: 5 });
		} finally {
			await context?.close();
			await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
		}
	});

	test('uses the browser quota and refuses growth into the shared reserve', async () => {
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-storage-recovery-'));
		let context: BrowserContext | null = null;
		const noteKey = 'halo_tool_state_sticky-notes';
		try {
			const launched = await launchHalo(profilePath);
			context = launched;
			const worker = await extensionWorker(launched);
			const quota = await worker.evaluate(async () => {
				const quota = chrome.storage.local.QUOTA_BYTES;
				await chrome.storage.local.set({ quota_probe_filler: 'x'.repeat(Math.floor(quota * 0.81)) });
				return { quota, used: await chrome.storage.local.getBytesInUse() };
			});
			expect(quota.used).toBeGreaterThan(quota.quota * 0.8);

			const page = await launched.newPage();
			await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
			await page.locator('button[data-tool-id="sticky-notes"]').click();
			await page.locator('button').filter({ hasText: /^\+\s/u }).first().click();
			await expect(page.getByText('The storage change exceeds its domain or shared reserve budget.')).toBeVisible();
			expect(await worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], noteKey)).toBeUndefined();
		} finally {
			await context?.close();
			await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
		}
	});

	test('copies legacy TOTP into extension-origin IndexedDB before optional deletion', async () => {
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-storage-recovery-'));
		let context: BrowserContext | null = null;
		const legacyKey = 'halo_tool_state_totp';
		const legacy = [{ id: 'browser-account', name: 'Account', issuer: 'Issuer', secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA1' }];
		try {
			const launched = await launchHalo(profilePath);
			context = launched;
			const worker = await extensionWorker(launched);
			await worker.evaluate(async ({ legacyKey, legacy }) => chrome.storage.local.set({ [legacyKey]: legacy, [`${legacyKey}#rev`]: 2 }), { legacyKey, legacy });
			const extensionId = new URL(worker.url()).hostname;
			const page = await launched.newPage();
			await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
			await page.locator('button[data-tool-id="totp"]').click();
			await expect(page.getByText('Existing local data is loaded unchanged; new edits remain in memory.')).toBeVisible();
			await page.getByRole('button', { name: 'Save to vault' }).click();
			await expect(page.getByText('Saved in the private extension vault.')).toBeVisible();
			expect(await worker.evaluate(async (legacyKey) => (await chrome.storage.local.get(legacyKey))[legacyKey], legacyKey)).toEqual(legacy);

			const vaultValue = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
				const open = indexedDB.open('halo_sensitive_vault');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const get = open.result.transaction('records', 'readonly').objectStore('records').get('totp-accounts');
					get.onerror = () => reject(get.error);
					get.onsuccess = () => resolve(get.result?.value);
				};
			}));
			expect(vaultValue).toEqual({ version: 1, items: legacy });

			await launched.route('https://vault-isolation.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<title>host-origin</title>' }));
			const hostPage = await launched.newPage();
			await hostPage.goto('https://vault-isolation.test/');
			expect(await hostPage.evaluate(async () => (await indexedDB.databases()).some((database) => database.name === 'halo_sensitive_vault'))).toBe(false);

			await page.getByRole('button', { name: 'Delete verified legacy copy' }).click();
			await expect.poll(() => worker.evaluate(async (legacyKey) => (await chrome.storage.local.get([legacyKey, `${legacyKey}#rev`]))[legacyKey], legacyKey)).toBeUndefined();
		} finally {
			await context?.close();
			await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
		}
	});
});
