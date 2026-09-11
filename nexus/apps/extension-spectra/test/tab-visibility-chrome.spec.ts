import { launchBrowser } from './helpers/browser-driver';
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
let profileDir = '';
const mediaPages: Page[] = [];
let foregroundPage: Page;
const mediaFixtures = [
	{ slug: 'alpha', title: 'Paused Media Alpha' },
	{ slug: 'beta', title: 'Paused Media Beta' },
	{ slug: 'gamma', title: 'Paused Media Gamma' },
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

async function openRealActionPopup(): Promise<Page> {
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
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname.startsWith('/media/')) {
				const slug = url.pathname.slice('/media/'.length);
				const fixture = mediaFixtures.find((entry) => entry.slug === slug);
				if (!fixture) return new Response('Not found', { status: 404 });
				return new Response(`<!doctype html><html><head><title>${fixture.title}</title></head><body><video id="media" controls></video></body></html>`, {
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
	browser = await launchBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
	});
	if (EXPECTED_CHROME) {
		expect(await browser.version()).toContain(EXPECTED_CHROME);
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
});

describe('SPECTRA real Popup media-tab inventory', () => {
	test('shows multiple paused background media tabs without acquiring the heavy Content Runtime', async () => {
		const tabIds = await Promise.all(mediaUrls.map(tabIdForUrl));
		const before = await Promise.all(mediaUrls.map(readBootstrapStatus));
		for (const status of before) expect(status).toMatchObject({ ready: false, runtimeRevision: null });
		for (const page of mediaPages) {
			expect(await page.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				return { exists: Boolean(media), paused: media?.paused ?? false };
			})).toEqual({ exists: true, paused: true });
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
				})),
				badge: document.getElementById('bg-badge')?.textContent ?? '',
				headerHidden: document.getElementById('bg-header')?.classList.contains('hidden') ?? true,
				pageScrollHeight: document.documentElement.scrollHeight,
				pageClientHeight: document.documentElement.clientHeight,
			}));
			expect(background.cards.map(({ title }) => title).sort()).toEqual(expectedTitles);
			expect(background.cards.every(({ domain }) => domain === '127.0.0.1')).toBe(true);
			expect(background.badge).toBe('3');
			expect(background.headerHidden).toBe(false);
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
});
