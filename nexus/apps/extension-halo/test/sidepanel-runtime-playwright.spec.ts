import { extensionWorker } from './helpers/extension-worker';
import { browserReplayPolicy } from '../../../scripts/browser-replay';
import { launchPlaywrightPersistentContext } from '../../../scripts/browser-driver';
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

function launchHalo(profilePath: string, profilePrefix: string) {
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
		owner: 'apps/extension-halo/test/sidepanel-runtime-playwright.spec.ts',
		profile: { kind: 'temporary', prefix: profilePrefix, isolated: true },
	});
}

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
	for (const externalRevision of [null, 43, 'removed'] as const) {
		test(`persists an edit during delayed hydration with ledger revision ${externalRevision ?? 'loaded'}`, async () => {
			const profilePath = await mkdtemp(join(tmpdir(), 'halo-hydration-runtime-'));
			let context: BrowserContext | null = null;
			const key = 'halo_tool_state_json-formatter';
			try {
				context = await launchHalo(profilePath, 'halo-hydration-runtime-');
				const worker = await extensionWorker(context);
				await worker.evaluate(async (key) => chrome.storage.local.set({ [key]: '{"stored":1}', [`${key}#rev`]: 41 }), key);
				const page = await context.newPage();
				await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
				await page.evaluate((key) => {
					const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
					let held = false;
					Object.defineProperty(chrome.storage.local, 'get', {
						configurable: true,
						value: async (keys: string | string[] | Record<string, unknown> | null) => {
							const snapshot = await originalGet(keys);
							if (!held && Array.isArray(keys) && keys.includes(key)) {
								held = true;
								Object.defineProperty(chrome.storage.local, 'get', { configurable: true, value: originalGet });
								await new Promise<void>((resolve) => {
									window.addEventListener('release-hydration', () => resolve(), { once: true });
									document.documentElement.dataset.hydrationHeld = 'true';
								});
							}
							return snapshot;
						},
					});
				}, key);
				await page.locator('button[data-tool-id="json-formatter"]').click();
				await expect(page.locator('html')).toHaveAttribute('data-hydration-held', 'true');
				const input = page.locator('textarea').first();
				if (externalRevision === 'removed') {
					await page.evaluate(async (key) => {
						await new Promise<void>((resolve, reject) => {
							const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
								if (area !== 'local' || !changes[`${key}#rev`] || changes[`${key}#rev`].newValue !== undefined) return;
								chrome.storage.onChanged.removeListener(listener);
								resolve();
							};
							chrome.storage.onChanged.addListener(listener);
							chrome.storage.local.remove(`${key}#rev`).catch((error) => {
								chrome.storage.onChanged.removeListener(listener);
								reject(error);
							});
						});
					}, key);
				} else if (externalRevision !== null) {
					await worker.evaluate(async ({ key, revision }) => chrome.storage.local.set({ [key]: '{"external":2}', [`${key}#rev`]: revision }), { key, revision: externalRevision });
					await expect(input).toHaveValue('{"external":2}');
				}
				await input.fill('{"draft":3}');
				await page.evaluate(() => window.dispatchEvent(new Event('release-hydration')));
				await expect.poll(() => worker.evaluate(async (key) => chrome.storage.local.get([key, `${key}#rev`]), key))
					.toEqual({ [key]: '{"draft":3}', [`${key}#rev`]: externalRevision === 'removed' ? 1 : (externalRevision ?? 41) + 1 });
				await expect(input).toHaveValue('{"draft":3}');
			} finally {
				await context?.close();
				await rm(profilePath, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
			}
		});
	}

	test('preserves home, hover preload, controlled state, lazy tools and portals', async () => {
		test.setTimeout(40_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-sidepanel-runtime-'));
		let context: BrowserContext | null = null;

		try {
			context = await launchHalo(profilePath, 'halo-sidepanel-runtime-');

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

			// An external value/revision, and then a revision-only event, must both
			// advance the hook's base before the next user edit can commit.
			const jsonKey = 'halo_tool_state_json-formatter';
			await worker.evaluate(async (key) => chrome.storage.local.set({ [key]: '{"external":1}', [`${key}#rev`]: 41 }), jsonKey);
			await expect(jsonInput).toHaveValue('{"external":1}');
			await jsonInput.fill('{"local":2}');
			await expect.poll(() => worker.evaluate(async (key) => chrome.storage.local.get([key, `${key}#rev`]), jsonKey))
				.toEqual({ [jsonKey]: '{"local":2}', [`${jsonKey}#rev`]: 42 });
			await page.evaluate(async (key) => {
				await new Promise<void>((resolve, reject) => {
					const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
						if (area !== 'local' || changes[`${key}#rev`]?.newValue !== 43) return;
						chrome.storage.onChanged.removeListener(listener);
						resolve();
					};
					chrome.storage.onChanged.addListener(listener);
					chrome.storage.local.set({ [`${key}#rev`]: 43 }).catch((error) => {
						chrome.storage.onChanged.removeListener(listener);
						reject(error);
					});
				});
			}, jsonKey);
			await jsonInput.fill('{"local":3}');
			await expect.poll(() => worker.evaluate(async (key) => chrome.storage.local.get([key, `${key}#rev`]), jsonKey))
				.toEqual({ [jsonKey]: '{"local":3}', [`${jsonKey}#rev`]: 44 });

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

	test('preserves saved accounts and API state across a complete browser restart', async () => {
		test.setTimeout(40_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-storage-retention-'));
		let context: BrowserContext | null = null;
		const saved = {
			halo_tool_state_totp: [{ id: 'retained-account', name: 'Retained account', issuer: 'Test', secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30 }],
			halo_tool_state_api_tester_placeholder: 'unrelated-key-must-survive',
			'halo_tool_state_api-tester-config': { method: 'GET', url: 'https://example.invalid/retained', headers: [{ id: 'retained-header', key: 'Authorization', value: 'test-only-value', enabled: true }], body: '', bodyType: 'none' },
		};
		try {
			for (const restart of [false, true]) {
				context = await test.step(
					`launch retained profile: restart=${restart}`,
					() => launchHalo(profilePath, 'halo-storage-retention-'),
					{ timeout: 10_000 },
				);
				const runningContext = context;
				const worker = await test.step('bind extension worker', () => extensionWorker(runningContext), { timeout: 10_000 });
				if (!restart) await test.step('seed saved records', () => worker.evaluate(async (values) => {
					await chrome.storage.local.set(values);
					await chrome.storage.session.set({ restartMarker: true });
				}, saved), { timeout: 5_000 });
				else expect(await worker.evaluate(() => chrome.storage.session.get('restartMarker'))).toEqual({});
				const page = await context.newPage();
				await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
				await test.step('open saved authenticator accounts', () => page.locator('button[data-tool-id="totp"]').click({ timeout: 5_000 }), { timeout: 6_000 });
				await expect(page.getByText('Retained account', { exact: true })).toBeVisible();
				await page.locator('[data-dock-item]').first().hover();
				await page.locator('[data-dock-item]').first().locator('button').nth(1).click();
				await expect(page.getByRole('heading', { name: 'HALO', exact: true })).toBeVisible();
				await test.step('open saved API request', () => page.locator('button[data-tool-id="api-tester"]').click({ timeout: 5_000 }), { timeout: 6_000 });
				await expect(page.locator('input[placeholder*="https://"]')).toHaveValue('https://example.invalid/retained');
				await page.locator('[data-dock-item]').first().hover();
				await page.locator('[data-dock-item]').first().locator('button').nth(1).click();
				await expect(page.getByRole('heading', { name: 'HALO', exact: true })).toBeVisible();
				// Closing a panel renders Home before its passive persistence effect
				// settles. Restart only after that navigation is physically retained.
				await expect.poll(() => worker.evaluate(() => chrome.storage.local.get(['halo_open_tools', 'halo_active_tool'])))
					.toEqual({ halo_open_tools: [], halo_active_tool: 'HALO_LAUNCHER' });
				await test.step('read physical storage owners', async () => {
					expect(await worker.evaluate((keys) => chrome.storage.local.get(keys), Object.keys(saved))).toEqual(saved);
					expect(await worker.evaluate((keys) => chrome.storage.session.get(keys), Object.keys(saved))).toEqual({});
				}, { timeout: 5_000 });
				await test.step('close browser completely', () => runningContext.close(), { timeout: 5_000 });
				context = null;
			}
		} finally {
			await context?.close();
			await rm(profilePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('XML output preserves document nodes, character data and declarations', async () => {
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-xml-fidelity-'));
		let context: BrowserContext | null = null;
		try {
			context = await launchHalo(profilePath, 'halo-xml-fidelity-');
			const worker = await extensionWorker(context);
			const page = await context.newPage();
			await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
			await page.locator('button[data-tool-id="xml-formatter"]').click();
			const input = page.locator('textarea');
			const vectors = [
				'\uFEFF<?xml version="1.0"?><root>retained BOM</root>',
				'\uFEFF<root>retained BOM without declaration</root>',
				'<?xml version="1.0"?><!--before--><?before x?><root xmlns:p="urn:test" xml:space="preserve" note="&quot;&amp;"> <p:child><![CDATA[a < b & c]]></p:child> </root><?after y?><!--after-->',
				'<p><b>A</b> <i>B</i></p>',
				'<!DOCTYPE root [<!ENTITY keep "retained">]><root>&keep;</root>',
				'<parsererror>ordinary data</parsererror>',
			];
			for (const xml of vectors) {
				await input.fill(xml);
				// biome-ignore lint/performance/useDomNodeTextContent: failure diagnostics must report the text a user can actually see, not hidden nodes.
				await expect(page.locator('pre'), `XML ${xml}; UI: ${await page.locator('body').innerText()}`).toHaveCount(2);
				const outputs = await page.locator('pre').allTextContents();
				for (const output of outputs) {
					const shapes = await page.evaluate(({ source, result }) => {
						const shape = (node: Node): unknown => ({
							type: node.nodeType, name: node.nodeName, value: node.nodeValue,
							attributes: node instanceof Element ? Array.from(node.attributes, (attr) => [attr.name, attr.value, attr.namespaceURI]) : [],
							children: Array.from(node.childNodes, shape),
						});
						const parser = new DOMParser();
						return { source: shape(parser.parseFromString(source, 'application/xml')), result: shape(parser.parseFromString(result, 'application/xml')) };
					}, { source: xml, result: output });
					expect(shapes.result, `XML output: ${output}`).toEqual(shapes.source);
					if (xml.startsWith('<?xml')) expect(output.startsWith('<?xml version="1.0"?>')).toBe(true);
					if (xml.startsWith('\uFEFF')) expect(output.startsWith('\uFEFF')).toBe(true);
					if (xml.startsWith('\uFEFF<?xml')) expect(output.startsWith('\uFEFF<?xml version="1.0"?>')).toBe(true);
					if (xml.startsWith('<!DOCTYPE')) expect(output).toBe(xml);
				}
			}
			await input.fill('<root><first/><second/></root>');
			await expect(page.locator('pre').first()).toHaveText('<root>\n  <first/>\n  <second/>\n</root>', { useInnerText: false });
			await input.fill('<root>');
			await expect(page.locator('pre')).toHaveCount(0);
			await expect(input).toHaveValue('<root>');
		} finally {
			await context?.close();
			await rm(profilePath, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
		}
	});
});
