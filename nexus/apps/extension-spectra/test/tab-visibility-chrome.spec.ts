import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target, WebWorker } from 'puppeteer';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

let browser: Browser;
let serviceWorker: WebWorker;
let extensionId = '';
let server: ReturnType<typeof Bun.serve>;
let frameServer: ReturnType<typeof Bun.serve>;
let profileDir = '';
const mediaPages: Page[] = [];
let foregroundPage: Page;
const mediaFixtures = [
	{ slug: 'alpha', title: 'Paused Media Alpha', frame: false },
	{ slug: 'beta', title: 'Paused Media Beta', frame: false },
	{ slug: 'gamma', title: 'Paused Muted Cross-Origin Media Gamma', frame: true },
] as const;
let mediaUrls: string[] = [];
let foregroundUrl = '';

interface BootstrapStatus {
	bootstrapRevision: string;
	runtimeRevision: string | null;
	ready: boolean;
	ownedSources: Array<{ mediaId: string; sourceRevision: number }>;
}

async function eventually<T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastValue: T | undefined;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			lastValue = await read();
			if (accept(lastValue)) return lastValue;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error(`${label} did not converge; last=${JSON.stringify(lastValue)}`, { cause: lastError });
}

async function tabIdForUrl(url: string): Promise<number> {
	return serviceWorker.evaluate(async (targetUrl) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find tab ${targetUrl}`);
		return tab.id;
	}, url);
}

async function readBootstrapStatus(url: string): Promise<BootstrapStatus> {
	return serviceWorker.evaluate(async (targetUrl) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find bootstrap tab ${targetUrl}`);
		const response = await chrome.tabs.sendMessage(tab.id, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: tab.id,
			type: 'spectra.content.runtime.status',
			payload: {},
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read content bootstrap');
		return response.data;
	}, url);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker attachment timed out')), timeoutMs)),
	]);
}

async function ensureServiceWorker(): Promise<boolean> {
	// The MV3 service worker can be recycled while idle, which detaches the
	// puppeteer worker handle acquired earlier. Re-resolve the live context so
	// popup opening and inventory reads do not fail on a stale execution context.
	// This runs once per popup open; hot-loop re-resolution hangs under load.
	const swTarget = browser.targets().find((target) => target.type() === 'service_worker'
		&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()));
	if (!swTarget) return false;
	const fresh = await withTimeout(swTarget.worker(), 5_000).catch(() => null);
	if (fresh) {
		serviceWorker = fresh;
		return true;
	}
	return false;
}

interface InventoryReader {
	page: Page;
	read(): Promise<{
		tabs: number[];
		coverage: { status: 'complete' | 'degraded'; denied: number; stale: number; unknown: number };
	}>;
	close(): Promise<void>;
}

// The extension Background never receives its own chrome.runtime.sendMessage
// (the sender context is excluded by the messaging contract), so the visible
// media inventory is read through the real Action Popup, which is the product
// consumer of the spectra.tab.visible.list RPC.
async function openInventoryReader(): Promise<InventoryReader> {
	const popup = await openRealActionPopup();
	try {
		await popup.waitForFunction(
			() => document.documentElement.dataset.spectraReady === 'true',
			{ timeout: 10_000 },
		);
	} catch (error) {
		await popup.close().catch(() => undefined);
		throw error;
	}
	return {
		page: popup,
		read: () => popup.evaluate(async () => {
			const response = await chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.visible.list',
				payload: {},
			});
			if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read Popup visible tabs');
			return response.data;
		}),
		close: () => closeActionPopup(popup),
	};
}

async function reportMediaFromCurrentDocument(tabId: number, hasMediaElement: boolean, reportRevision: number): Promise<void> {
	const response = await serviceWorker.evaluate(async ({ targetTabId, hasMedia, revision }) => {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			func: async (reportedMedia: boolean, reportedRevision: number) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.media.report',
				payload: {
					hasMediaElement: reportedMedia,
					userInteracted: false,
					reportRevision: reportedRevision,
				},
			}),
			args: [hasMedia, revision],
		});
		return result?.result;
	}, { targetTabId: tabId, hasMedia: hasMediaElement, revision: reportRevision });
	if (!response?.ok) throw new Error(response?.error?.message ?? 'Current document media report failed');
}

async function openRealActionPopup(): Promise<Page> {
	await ensureServiceWorker();
	const knownTargets = new Set(browser.targets());
	const popupUrl = `chrome-extension://${extensionId}/popup.html`;
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target) && target.url() === popupUrl,
		{ timeout: 10_000 },
	);
	await serviceWorker.evaluate(async () => chrome.action.openPopup());
	const target = await targetPromise;
	const page = await target.asPage();
	if (!page) throw new Error('Unable to attach to the real SPECTRA action popup');
	return page;
}

async function closeActionPopup(page: Page): Promise<void> {
	if (page.isClosed()) return;
	await page.evaluate(() => window.close()).catch(() => undefined);
	await eventually(
		async () => page.isClosed(),
		(closed) => closed,
		'action popup retirement',
		2_000,
	).catch(async () => {
		if (!page.isClosed()) await page.close();
	});
}

beforeAll(async () => {
	frameServer = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname !== '/cross-origin-media') return new Response('Not found', { status: 404 });
			return new Response('<!doctype html><html><body><video id="media" muted controls></video></body></html>', {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		},
	});
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === '/navigation/media') {
				return new Response('<!doctype html><html><head><title>Navigation Old Media</title></head><body><video controls></video></body></html>', {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			if (url.pathname === '/navigation/empty') {
				return new Response('<!doctype html><html><head><title>Navigation New Empty</title></head><body>empty</body></html>', {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			if (url.pathname.startsWith('/media/')) {
				const slug = url.pathname.slice('/media/'.length);
				const fixture = mediaFixtures.find((entry) => entry.slug === slug);
				if (!fixture) return new Response('Not found', { status: 404 });
				const media = fixture.frame
					? `<iframe title="cross-origin-media" src="http://127.0.0.1:${frameServer.port}/cross-origin-media"></iframe>`
					: '<video id="media" controls></video>';
				return new Response(`<!doctype html><html><head><title>${fixture.title}</title></head><body>${media}</body></html>`, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			if (url.pathname === '/foreground') {
				return new Response(`<!doctype html><html><head><title>Foreground Without Media</title></head><body>foreground</body></html>`, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			return new Response('Not found', { status: 404 });
		},
	});
	mediaUrls = mediaFixtures.map(({ slug }) => `http://127.0.0.1:${server.port}/media/${slug}`);
	foregroundUrl = `http://127.0.0.1:${server.port}/foreground`;
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-tab-visibility-'));
	browser = await launchPuppeteerBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--autoplay-policy=no-user-gesture-required',
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
	}, {
		owner: 'apps/extension-spectra/test/tab-visibility-chrome.spec.ts',
		profile: { kind: 'temporary', prefix: 'spectra-tab-visibility-', isolated: true },
	});
	if (EXPECTED_CHROME) {
		expect((await browser.version()).split('/').pop()).toBe(EXPECTED_CHROME);
	}

	const serviceWorkerTarget: Target = await browser.waitForTarget(
		(target) => target.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(serviceWorkerTarget.url()).host;
	const worker = await serviceWorkerTarget.worker();
	if (!worker) throw new Error('SPECTRA service worker target has no execution context');
	serviceWorker = worker;

	for (const url of mediaUrls) {
		const page = await browser.newPage();
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await eventually(
			() => readBootstrapStatus(url),
			(status) => status.bootstrapRevision.length > 0,
			`background media bootstrap ${url}`,
		);
		mediaPages.push(page);
	}

	foregroundPage = await browser.newPage();
	await foregroundPage.goto(foregroundUrl, { waitUntil: 'domcontentloaded' });
	await foregroundPage.bringToFront();

	// Retire the puppeteer default about:blank page: a non-probeable tab is
	// counted as denied coverage by contract, which would degrade an otherwise
	// complete inventory scan. Every remaining tab here is probeable.
	for (const page of await browser.pages()) {
		if (page.url() === 'about:blank' || page.url() === '') {
			await page.close().catch(() => undefined);
		}
	}
}, 60_000);

afterAll(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) {
		await rm(profileDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
	server?.stop(true);
	frameServer?.stop(true);
});

describe('SPECTRA real Popup media-tab inventory', () => {
	test('shows multiple paused background media tabs without acquiring the heavy Content Runtime', async () => {
		const tabIds = await Promise.all(mediaUrls.map(tabIdForUrl));
		const before = await Promise.all(mediaUrls.map(readBootstrapStatus));
		for (const status of before) expect(status).toMatchObject({ ready: false, runtimeRevision: null });
		for (const [index, page] of mediaPages.entries()) {
			const observed = (await Promise.all(page.frames().map(async (frame) => frame.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				return media ? { paused: media.paused, muted: media.muted } : null;
			})))).filter((value) => value !== null);
			expect(observed).toHaveLength(1);
			expect(observed[0]?.paused).toBe(true);
			expect(observed[0]?.muted).toBe(index === 2);
		}

		const popup = await openRealActionPopup();
		try {
			const expectedTitles = mediaFixtures.map(({ title }) => title).sort();
			await popup.waitForFunction((titles) => {
				const actual = [...document.querySelectorAll<HTMLElement>('#bg-stack .glass-card .meta-title')]
					.map((element) => element.textContent ?? '')
					.sort();
				return JSON.stringify(actual) === JSON.stringify(titles);
			}, { timeout: 10_000 }, expectedTitles);

			const background = await popup.evaluate(() => ({
				cards: [...document.querySelectorAll<HTMLElement>('#bg-stack .glass-card')].map((card) => ({
					title: card.querySelector<HTMLElement>('.meta-title')?.textContent ?? '',
					domain: card.querySelector<HTMLElement>('.meta-domain')?.textContent ?? '',
					controlCoverage: card.dataset.controlCoverage,
					controlsInert: card.querySelector<HTMLElement>('.control-stack')?.hasAttribute('inert') ?? false,
				})),
				badge: document.getElementById('bg-badge')?.textContent ?? '',
				headerHidden: document.getElementById('bg-header')?.classList.contains('hidden') ?? true,
				inventoryEvidence: document.documentElement.dataset.mediaInventory,
				inventoryStatusHidden: document.getElementById('media-inventory-status')?.hidden ?? false,
				pageScrollHeight: document.documentElement.scrollHeight,
				pageClientHeight: document.documentElement.clientHeight,
			}));
			expect(background.cards.map(({ title }) => title).sort()).toEqual(expectedTitles);
			expect(background.cards.every(({ domain }) => domain === '127.0.0.1')).toBe(true);
			expect(background.badge).toBe('3');
			expect(background.headerHidden).toBe(false);
			expect(background.inventoryEvidence).toBe('complete');
			expect(background.inventoryStatusHidden).toBe(true);
			expect(background.cards.every(({ controlCoverage }) => controlCoverage === 'unknown')).toBe(true);
			expect(background.cards.every(({ controlsInert }) => controlsInert)).toBe(true);
			// If the physical Action Popup height cannot fit all cards, the document
			// must grow/scroll rather than clipping or silently dropping cards.
			expect(background.pageScrollHeight).toBeGreaterThanOrEqual(background.pageClientHeight);

			const popupVisibleTabs = await popup.evaluate(async () => {
				const response = await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.tab.visible.list',
					payload: {},
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read Popup visible tabs');
				return response.data.tabs as number[];
			});
			for (const tabId of tabIds) expect(popupVisibleTabs).toContain(tabId);

			const after = await Promise.all(mediaUrls.map(readBootstrapStatus));
			for (const status of after) expect(status).toMatchObject({ ready: false, runtimeRevision: null });
		} finally {
			await closeActionPopup(popup);
		}
	}, 45_000);

	test('retires an old document report across a real top-level navigation generation', async () => {
		const page = await browser.newPage();
		try {
			const oldUrl = `http://127.0.0.1:${server.port}/navigation/media`;
			const newUrl = `http://127.0.0.1:${server.port}/navigation/empty`;
			await page.goto(oldUrl, { waitUntil: 'domcontentloaded' });
			await eventually(
				() => readBootstrapStatus(oldUrl),
				(status) => status.bootstrapRevision.length > 0,
				'old navigation bootstrap',
			);
			const tabId = await tabIdForUrl(oldUrl);
			const oldDocumentId = await serviceWorker.evaluate(async (targetTabId) => {
				const frames = await chrome.webNavigation.getAllFrames({ tabId: targetTabId });
				return frames?.find((frame) => frame.frameId === 0)?.documentId ?? null;
			}, tabId);
			expect(oldDocumentId).toBeString();
			await reportMediaFromCurrentDocument(tabId, true, 10_000);
			const reader = await openInventoryReader();
			try {
				expect((await reader.read()).tabs).toContain(tabId);

				await page.goto(newUrl, { waitUntil: 'domcontentloaded' });
				await eventually(
					() => readBootstrapStatus(newUrl),
					(status) => status.bootstrapRevision.length > 0,
					'new navigation bootstrap',
				);
				const newDocumentId = await serviceWorker.evaluate(async (targetTabId) => {
					const frames = await chrome.webNavigation.getAllFrames({ tabId: targetTabId });
					return frames?.find((frame) => frame.frameId === 0)?.documentId ?? null;
				}, tabId);
				expect(newDocumentId).toBeString();
				expect(newDocumentId).not.toBe(oldDocumentId);
				await eventually(
					() => reader.read(),
					(inventory) => inventory.coverage.status === 'complete' && !inventory.tabs.includes(tabId),
					'old document media report retirement',
				);
			} finally {
				await reader.close();
			}
		} finally {
			await page.close();
		}
	}, 30_000);

	test('reports a restricted audible tab as degraded without creating an actionable card', async () => {
		const restricted = await browser.newPage();
		try {
			await restricted.goto('data:text/html,<title>Restricted Audible Fixture</title><body>restricted</body>');
			await restricted.evaluate(async () => {
				const context = new AudioContext();
				const oscillator = context.createOscillator();
				oscillator.connect(context.destination);
				oscillator.start();
				await context.resume();
				Object.assign(window, { __spectraAudioContext: context, __spectraOscillator: oscillator });
			});
			const restrictedTab = await eventually(
				() => serviceWorker.evaluate(async () => (await chrome.tabs.query({}))
					.find((tab) => tab.title === 'Restricted Audible Fixture') ?? null),
				(tab) => Number.isSafeInteger(tab?.id),
				'restricted tab resolution',
			);
			if (!restrictedTab?.id) throw new Error('Restricted audible tab has no id');
			await foregroundPage.bringToFront();
			const reader = await openInventoryReader();
			try {
				const inventory = await reader.read();
				expect(inventory.tabs).not.toContain(restrictedTab.id);
				expect(inventory.coverage.status).toBe('degraded');
				expect(inventory.coverage.denied).toBeGreaterThanOrEqual(1);

				const state = await reader.page.evaluate(() => ({
					inventory: document.documentElement.dataset.mediaInventory,
					statusHidden: document.getElementById('media-inventory-status')?.hidden ?? true,
					restrictedCard: [...document.querySelectorAll<HTMLElement>('.meta-title')]
						.some((element) => element.textContent === 'Restricted Audible Fixture'),
				}));
				expect(state).toEqual({ inventory: 'partial', statusHidden: false, restrictedCard: false });
			} finally {
				await reader.close();
			}
		} finally {
			await restricted.close();
		}
	}, 30_000);
});
