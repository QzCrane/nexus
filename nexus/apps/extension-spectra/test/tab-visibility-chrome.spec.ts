import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page, type Target, type WebWorker } from 'puppeteer';

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
let mediaPage: Page;
let foregroundPage: Page;
let mediaUrl = '';
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
			const pathname = new URL(request.url).pathname;
			if (pathname === '/media') {
				return new Response(`<!doctype html><html><head><title>Paused Media Inventory</title></head><body><video id="media" controls></video></body></html>`, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			if (pathname === '/foreground') {
				return new Response(`<!doctype html><html><head><title>Foreground Without Media</title></head><body>foreground</body></html>`, {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			return new Response('Not found', { status: 404 });
		},
	});
	mediaUrl = `http://127.0.0.1:${server.port}/media`;
	foregroundUrl = `http://127.0.0.1:${server.port}/foreground`;
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-tab-visibility-'));
	browser = await puppeteer.launch({
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

	mediaPage = await browser.newPage();
	await mediaPage.goto(mediaUrl, { waitUntil: 'domcontentloaded' });
	await eventually(
		() => readBootstrapStatus(mediaUrl),
		(status) => status.bootstrapRevision.length > 0,
		'background media bootstrap',
	);

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
	test('shows a paused background media tab without acquiring the heavy Content Runtime', async () => {
		const mediaTabId = await tabIdForUrl(mediaUrl);
		const before = await readBootstrapStatus(mediaUrl);
		expect(before).toMatchObject({ ready: false, runtimeRevision: null });
		expect(await mediaPage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			return { exists: Boolean(media), paused: media?.paused ?? false };
		})).toEqual({ exists: true, paused: true });

		const popup = await openRealActionPopup();
		try {
			await popup.waitForFunction((expectedTitle) => (
				[...document.querySelectorAll<HTMLElement>('#bg-stack .glass-card .meta-title')]
					.some((element) => element.textContent === expectedTitle)
			), { timeout: 10_000 }, 'Paused Media Inventory');

			const backgroundCards = await popup.evaluate(() => (
				[...document.querySelectorAll<HTMLElement>('#bg-stack .glass-card')].map((card) => ({
					title: card.querySelector<HTMLElement>('.meta-title')?.textContent ?? '',
					domain: card.querySelector<HTMLElement>('.meta-domain')?.textContent ?? '',
				}))
			));
			expect(backgroundCards).toEqual([
				{ title: 'Paused Media Inventory', domain: '127.0.0.1' },
			]);

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
			expect(popupVisibleTabs).toContain(mediaTabId);

			const after = await readBootstrapStatus(mediaUrl);
			expect(after).toMatchObject({ ready: false, runtimeRevision: null });
		} finally {
			await closeActionPopup(popup);
		}
	}, 30_000);
});
