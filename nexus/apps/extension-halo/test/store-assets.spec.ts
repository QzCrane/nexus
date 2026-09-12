import { browserReplayPolicy } from '../../../scripts/browser-replay';
import { launchPlaywrightPersistentContext } from '../../../scripts/browser-driver';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { verifyVisualRegressionCandidate } from '../../../scripts/verify-visual-regression-candidate';

const extensionDir = fileURLToPath(new URL('../', import.meta.url));
const workspaceDir = resolve(extensionDir, '../..');
const distPath = resolve(extensionDir, 'dist');
const updateBaseline = process.env.NEXUS_UPDATE_VISUAL_BASELINE === '1';
const explicitChrome = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const expectedChrome = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (explicitChrome && !existsSync(explicitChrome)) throw new Error(`Pinned Chrome executable is missing: ${explicitChrome}`);
if (updateBaseline && !explicitChrome) throw new Error('HALO visual baseline update requires NEXUS_CHROME_EXECUTABLE');

const states = {
	home: {
		id: 'halo.sidepanel.home-data.dark.en.1280x800', scenario: 'data', assertions: ['home-populated', 'focus-visible'], focusTarget: 'json-formatter',
		width: 1280, height: 800, locale: 'en', theme: 'dark', file: 'halo-sidepanel-home-data-1280x800.png',
	},
	jsonError: {
		id: 'halo.sidepanel.json-error.light.zh-CN.320x800', scenario: 'error', assertions: ['invalid-json-visible', 'narrow-layout', 'focus-visible'], focusTarget: 'json-input',
		width: 320, height: 800, locale: 'zh-CN', theme: 'light', file: 'halo-sidepanel-json-error-320x800.png',
	},
	permission: {
		id: 'halo.sidepanel.permission-denied.dark.en.520x760', scenario: 'permission-denied', assertions: ['cookies-not-granted', 'permission-required-visible', 'focus-visible'], focusTarget: 'grant-permission',
		width: 520, height: 760, locale: 'en', theme: 'dark', file: 'halo-sidepanel-permission-denied-520x760.png',
	},
} as const;

async function prepare(page: Page, worker: Worker, state: (typeof states)[keyof typeof states]): Promise<void> {
	await page.setViewportSize({ width: state.width, height: state.height });
	await page.emulateMedia({ colorScheme: state.theme, reducedMotion: 'reduce' });
	await worker.evaluate(async ({ locale, theme }) => {
		await chrome.storage.sync.set({ halo_locale: locale === 'zh-CN' ? 'zh' : locale, HALO_SETTINGS: { theme } });
		await chrome.storage.local.set({ halo_open_tools: [], halo_active_tool: 'HALO_LAUNCHER' });
	}, { locale: state.locale, theme: state.theme });
	await page.reload({ waitUntil: 'load' });
}

async function capture(page: Page, state: (typeof states)[keyof typeof states]): Promise<void> {
	const baselinePath = resolve(extensionDir, `store-listings/assets/${state.file}`);
	const candidatePath = resolve(workspaceDir, `../artifacts/visual-candidates/${state.file}`);
	const screenshotPath = updateBaseline ? baselinePath : candidatePath;
	await mkdir(dirname(screenshotPath), { recursive: true });
	const png = Buffer.from(await page.screenshot({ animations: 'disabled', fullPage: false }));
	if (png.readUInt32BE(16) !== state.width || png.readUInt32BE(20) !== state.height) {
		throw new Error(`${state.id}: physical PNG dimensions differ from ${state.width}x${state.height}`);
	}
	await writeFile(screenshotPath, png);
	const verification = verifyVisualRegressionCandidate({ stateId: state.id, candidatePath, baselinePath, updateBaseline });
	console.log(`✓ HALO ${state.scenario} visual ${verification.mode} ${verification.sha256}: ${screenshotPath}`);
}

test('captures populated, error, narrow, focused and permission-denied HALO states', async () => {
	test.setTimeout(60_000);
	const profilePath = await mkdtemp(join(tmpdir(), 'halo-store-assets-'));
	let context: BrowserContext | null = null;
	try {
		context = await launchPlaywrightPersistentContext(chromium, profilePath, {
			...(explicitChrome ? { executablePath: explicitChrome } : { channel: 'chromium' as const }),
			headless: true,
			viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
			args: [...browserReplayPolicy(expectedChrome, explicitChrome, process.platform).args, `--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
		}, { owner: 'apps/extension-halo/test/store-assets.spec.ts', profile: { kind: 'temporary', prefix: 'halo-store-assets-', isolated: true } });
		const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
		const extensionId = new URL(worker.url()).host;
		const page = await context.newPage();
		if (expectedChrome) {
			const cdp = await context.newCDPSession(page);
			try { expect((await cdp.send('Browser.getVersion')).product).toContain(expectedChrome); }
			finally { await cdp.detach(); }
		}
		await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });

		await prepare(page, worker, states.home);
		const jsonTool = page.locator('button[data-tool-id="json-formatter"]');
		await expect(jsonTool).toBeVisible();
		expect(await page.locator('button[data-tool-id]').count()).toBeGreaterThan(20); // home-populated
		await jsonTool.focus();
		await expect(jsonTool).toBeFocused(); // focus-visible
		await capture(page, states.home);

		await prepare(page, worker, states.jsonError);
		await page.locator('button[data-tool-id="json-formatter"]').click();
		const input = page.locator('textarea').first();
		await input.fill('{"broken":');
		await page.getByRole('button', { name: '✨ 格式化' }).click();
		await expect(page.getByText('Invalid JSON', { exact: true })).toBeVisible(); // invalid-json-visible
		await input.focus();
		await expect(input).toBeFocused(); // narrow-layout, focus-visible, json-input
		await capture(page, states.jsonError);

		await prepare(page, worker, states.permission);
		await worker.evaluate(async () => { await chrome.permissions.remove({ permissions: ['cookies'] }); });
		await page.locator('button[data-tool-id="cookie-manager"]').click();
		const grant = page.getByRole('button', { name: /Grant Permission/u });
		await expect(grant).toBeVisible(); // cookies-not-granted, permission-required-visible
		await grant.focus();
		await expect(grant).toBeFocused(); // focus-visible, grant-permission
		await capture(page, states.permission);
	} finally {
		await context?.close();
		await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});
