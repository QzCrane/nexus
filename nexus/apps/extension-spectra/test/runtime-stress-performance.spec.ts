import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page, type Target, type WebWorker } from 'puppeteer';
import {
	runtimePerformanceIdentityFromEnvironment,
	runtimePerformanceOutputPath,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
const MEDIA_TAB_COUNT = 20;
const SAMPLE_COUNT = 20;
const OUTPUT_PATH = runtimePerformanceOutputPath('spectra-runtime-stress.json');
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

interface BootstrapStatus {
	ready: boolean;
	runtimeRevision: string | null;
	bootstrapRevision: string;
}

async function eventually<T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	while (Date.now() < deadline) {
		last = await read();
		if (accept(last)) return last;
		await new Promise((resolveWait) => setTimeout(resolveWait, 20));
	}
	throw new Error(`${label} did not converge; last=${JSON.stringify(last)}`);
}

async function tabIdForUrl(worker: WebWorker, url: string): Promise<number> {
	return worker.evaluate(async (targetUrl) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to resolve tab ${targetUrl}`);
		return tab.id;
	}, url);
}

async function readBootstrapStatus(worker: WebWorker, tabId: number): Promise<BootstrapStatus> {
	return worker.evaluate(async (targetTabId) => {
		const response = await chrome.tabs.sendMessage(targetTabId, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.content.runtime.status',
			payload: {},
			tabId: targetTabId,
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read bootstrap status');
		return response.data;
	}, tabId);
}

async function waitForBootstrap(worker: WebWorker, tabId: number): Promise<BootstrapStatus> {
	return eventually(
		() => readBootstrapStatus(worker, tabId),
		(status) => status.bootstrapRevision.length > 0,
		`bootstrap for tab ${tabId}`,
	);
}

async function firstSpeedUpLatency(page: Page): Promise<number> {
	await page.bringToFront();
	await page.evaluate(() => {
		const media = document.querySelector<HTMLMediaElement>('video,audio');
		if (!media) throw new Error('Performance fixture media is missing');
		media.playbackRate = 1;
	});
	const started = performance.now();
	await page.keyboard.down('Alt');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.up('Alt');
	await eventually(
		() => page.evaluate(() => document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? 0),
		(value) => value >= 1.09,
		'first default speed-up hotkey actual readback',
	);
	return performance.now() - started;
}

async function openRealActionPopup(browser: Browser, worker: WebWorker, extensionId: string): Promise<Page> {
	const knownTargets = new Set(browser.targets());
	const popupUrl = `chrome-extension://${extensionId}/popup.html`;
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target) && target.url() === popupUrl,
		{ timeout: 10_000 },
	);
	await worker.evaluate(async () => chrome.action.openPopup());
	const target = await targetPromise;
	const popup = await target.asPage();
	if (!popup) throw new Error('Unable to attach to SPECTRA Action Popup');
	return popup;
}

async function closeActionPopup(page: Page): Promise<void> {
	if (page.isClosed()) return;
	await page.evaluate(() => window.close()).catch(() => undefined);
	await eventually(
		async () => page.isClosed(),
		(closed) => closed,
		'Action Popup close',
		2_000,
	).catch(async () => {
		if (!page.isClosed()) await page.close();
	});
}

test('records scaled inventory, full Popup rendering, and first-hotkey physical runtime latency', async () => {
	const profileDir = await mkdtemp(join(tmpdir(), 'spectra-runtime-stress-'));
	let browser: Browser | null = null;
	let server: ReturnType<typeof Bun.serve> | null = null;
	const pages: Page[] = [];
	try {
		server = Bun.serve({
			port: 0,
			hostname: '127.0.0.1',
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname !== '/media') return new Response('not found', { status: 404 });
				return new Response(
					`<!doctype html><html><head><title>Runtime Stress ${url.searchParams.get('id') ?? ''}</title></head><body><video controls muted></video></body></html>`,
					{ headers: { 'content-type': 'text/html; charset=utf-8' } },
				);
			},
		});
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
		const browserVersion = await browser.version();
		if (EXPECTED_CHROME) expect(browserVersion).toContain(EXPECTED_CHROME);
		const workerTarget: Target = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
		const extensionId = new URL(workerTarget.url()).host;
		const worker = await workerTarget.worker();
		if (!worker) throw new Error('SPECTRA service worker target has no execution context');

		const tabIds: number[] = [];
		for (let index = 0; index < MEDIA_TAB_COUNT; index += 1) {
			const page = await browser.newPage();
			const url = `http://127.0.0.1:${server.port}/media?id=${index}`;
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			const tabId = await tabIdForUrl(worker, url);
			await waitForBootstrap(worker, tabId);
			pages.push(page);
			tabIds.push(tabId);
		}

		const probeTabId = tabIds[0];
		if (probeTabId === undefined) throw new Error('No media tab was created');
		expect(await readBootstrapStatus(worker, probeTabId)).toMatchObject({ ready: false, runtimeRevision: null });
		const options = await browser.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.bringToFront();
		const samples: RuntimePerformanceSample[] = [];
		for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
			const started = performance.now();
			const visible = await options.evaluate(async () => {
				const response = await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.tab.visible.list',
					payload: {},
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'visible-list failed');
				return response.data.tabs as number[];
			});
			samples.push({
				metric: 'spectra.media-tabs20.inventory-roundtrip',
				value: performance.now() - started,
				unit: 'ms',
			});
			for (const tabId of tabIds) expect(visible).toContain(tabId);
		}
		expect(await readBootstrapStatus(worker, probeTabId)).toMatchObject({ ready: false, runtimeRevision: null });

		for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
			await options.bringToFront();
			const started = performance.now();
			const popup = await openRealActionPopup(browser, worker, extensionId);
			try {
				await popup.waitForSelector('#bg-stack .glass-card', { timeout: 10_000 });
				const firstReadyAt = performance.now();
				await popup.waitForFunction(
					(expectedCount) => document.querySelectorAll('#bg-stack .glass-card').length >= expectedCount,
					{ timeout: 20_000 },
					MEDIA_TAB_COUNT,
				);
				const allReadyAt = performance.now();
				samples.push(
					{
						metric: 'spectra.media-tabs20.popup-first-card-ready',
						value: firstReadyAt - started,
						unit: 'ms',
					},
					{
						metric: 'spectra.media-tabs20.popup-all-cards-ready',
						value: allReadyAt - started,
						unit: 'ms',
					},
				);
				expect(await popup.$eval('#bg-badge', (element) => element.textContent)).toBe(String(MEDIA_TAB_COUNT));
			} finally {
				await closeActionPopup(popup);
			}
		}
		expect(await readBootstrapStatus(worker, probeTabId)).toMatchObject({ ready: false, runtimeRevision: null });

		for (const page of pages) {
			samples.push({
				metric: 'spectra.hotkey.speed-up.first-document-e2e',
				value: await firstSpeedUpLatency(page),
				unit: 'ms',
			});
		}

		for (const metric of [
			'spectra.media-tabs20.inventory-roundtrip',
			'spectra.media-tabs20.popup-first-card-ready',
			'spectra.media-tabs20.popup-all-cards-ready',
			'spectra.hotkey.speed-up.first-document-e2e',
		]) {
			expect(samples.filter((sample) => sample.metric === metric), metric).toHaveLength(SAMPLE_COUNT);
		}
		writeRuntimePerformanceEvidence({
			product: 'spectra',
			browser: { name: 'Chrome', version: browserVersion },
			samples,
			outputPath: OUTPUT_PATH,
			identity: runtimePerformanceIdentityFromEnvironment(),
		});
	} finally {
		await browser?.close().catch(() => undefined);
		server?.stop(true);
		await rm(profileDir, {
			force: true,
			recursive: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
}, 300_000);
