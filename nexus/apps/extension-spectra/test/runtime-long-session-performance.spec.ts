import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { TONE_PATH, toneResponse } from './helpers/media-fixture';
import { expect } from 'bun:test';
import { chromeIntegrationEnabled, testChrome } from './helpers/chrome-integration';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import type { Browser, CDPSession, Page, Target } from 'puppeteer';
import {
	runtimePerformanceIdentityFromEnvironment,
	runtimePerformanceOutputPath,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
const BATCH_COUNT = 20;
const HOTKEY_PAIRS_PER_BATCH = 10;
const OUTPUT_PATH = runtimePerformanceOutputPath('spectra-long-session.json');
if (chromeIntegrationEnabled && !existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (chromeIntegrationEnabled && EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

async function tapShortcut(page: Page, key: 'ArrowLeft' | 'ArrowRight'): Promise<void> {
	await page.keyboard.down('Alt');
	await page.keyboard.press(key);
	await page.keyboard.up('Alt');
}

function metricValue(
	metrics: Array<{ name: string; value: number }>,
	name: string,
): number {
	const value = metrics.find((entry) => entry.name === name)?.value;
	if (!Number.isFinite(value)) throw new Error(`Chromium Performance metric is missing: ${name}`);
	return Number(value);
}

async function waitForBootstrap(options: Page, tabId: number): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const status = await options.evaluate(async (targetTabId) => {
			try {
				const response = await chrome.tabs.sendMessage(targetTabId, {
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.content.runtime.status',
					payload: {},
					tabId: targetTabId,
				});
				return response?.ok ? response.data : null;
			} catch {
				return null;
			}
		}, tabId);
		if (status?.bootstrapRevision) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error('SPECTRA long-session fixture bootstrap did not become ready');
}

async function readRuntimeStatus(options: Page, tabId: number): Promise<{
	ready: boolean;
	runtimeRevision: string | null;
}> {
	return options.evaluate(async (targetTabId) => {
		const response = await chrome.tabs.sendMessage(targetTabId, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.content.runtime.status',
			payload: {},
			tabId: targetTabId,
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read runtime status');
		return { ready: response.data.ready, runtimeRevision: response.data.runtimeRevision };
	}, tabId);
}

testChrome('records long-session hotkey, heap, CPU, context and long-task evidence', async () => {
	const profileDir = await mkdtemp(join(tmpdir(), 'spectra-long-session-'));
	let browser: Browser | null = null;
	let server: ReturnType<typeof Bun.serve> | null = null;
	let rendererClient: CDPSession | null = null;
	try {
		server = Bun.serve({
			port: 0,
			hostname: '127.0.0.1',
			fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === TONE_PATH) return toneResponse();
				if (path !== '/media') return new Response('not found', { status: 404 });
				return new Response(
					`<!doctype html><html><head><title>SPECTRA Long Session</title></head><body><video id="media" controls muted preload="auto" src="${TONE_PATH}"></video></body></html>`,
					{ headers: { 'content-type': 'text/html; charset=utf-8' } },
				);
			},
		});
		browser = await launchPuppeteerBrowser({
			...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
			headless: true,
			userDataDir: profileDir,
			args: [
				`--disable-extensions-except=${EXTENSION_DIR}`,
				`--load-extension=${EXTENSION_DIR}`,
				'--no-sandbox',
			'--disable-setuid-sandbox',
		],
		}, {
			owner: 'apps/extension-spectra/test/runtime-long-session-performance.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-long-session-', isolated: true },
		});
		const browserVersion = await browser.version();
		if (EXPECTED_CHROME) expect(browserVersion).toContain(EXPECTED_CHROME);
		const workerTarget: Target = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
		const extensionId = new URL(workerTarget.url()).host;
		const mediaPage = await browser.newPage();
		const mediaUrl = `http://127.0.0.1:${server.port}/media`;
		await mediaPage.goto(mediaUrl, { waitUntil: 'domcontentloaded' });
		const options = await browser.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		const tabId = await options.evaluate(async (url) => {
			const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
			if (tab?.id === undefined) throw new Error(`Unable to find long-session tab ${url}`);
			return tab.id;
		}, mediaUrl);
		await waitForBootstrap(options, tabId);
		rendererClient = await mediaPage.createCDPSession();
		await rendererClient.send('Performance.enable');
		await rendererClient.send('HeapProfiler.enable');
		const baselineMetrics = (await rendererClient.send('Performance.getMetrics')).metrics;
		let previousTaskDuration = metricValue(baselineMetrics, 'TaskDuration');
		let previousScriptDuration = metricValue(baselineMetrics, 'ScriptDuration');
		let previousThreadTime = metricValue(baselineMetrics, 'ThreadTime');
		const longTaskSupported = await mediaPage.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'));
		expect(longTaskSupported).toBe(true);
		await mediaPage.evaluate(() => {
			const scope = window as Window & {
				__spectraLongTaskProbe?: { entries: number[]; cursor: number };
			};
			const state = { entries: [] as number[], cursor: 0 };
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) state.entries.push(entry.duration);
			});
			observer.observe({ type: 'longtask', buffered: true });
			scope.__spectraLongTaskProbe = state;
		});

		const samples: RuntimePerformanceSample[] = [];
		for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
			await mediaPage.bringToFront();
			const batchStarted = performance.now();
			for (let pair = 0; pair < HOTKEY_PAIRS_PER_BATCH; pair += 1) {
				await tapShortcut(mediaPage, 'ArrowRight');
				await tapShortcut(mediaPage, 'ArrowLeft');
			}
			const batchElapsed = performance.now() - batchStarted;
			// Keyup releases observation, not the user's persistent control intent.
			// Verify one live runtime while controlled, then explicitly restore the
			// page before sampling post-release retention. No implicit reset is
			// injected into production to make this metric look smaller.
			const controlled = await readRuntimeStatus(options, tabId);
			expect(controlled.ready).toBe(true);
			expect(controlled.runtimeRevision).not.toBeNull();
			await new Promise((resolveWait) => setTimeout(resolveWait, 350));
			expect(await readRuntimeStatus(options, tabId)).toEqual(controlled);
			// Exercise the real permitted source; Options is not a control authority.
			const popupTarget = browser.waitForTarget(
				(target) => target.url() === `chrome-extension://${extensionId}/popup.html`,
				{ timeout: 10_000 },
			);
			await options.evaluate(async () => chrome.action.openPopup());
			const popup = await (await popupTarget).asPage();
			try {
				await popup.evaluate(async (targetTabId) => {
				const response = await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.control.operation.submit',
					tabId: targetTabId,
					payload: { tabId: targetTabId, source: 'popup', target: null,
						operation: 'restore-page-settings', payload: {} },
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Page settings release failed');
			}, tabId);
			} finally {
				// Abrupt target destruction deliberately does not rely on pagehide
				// delivery. The browser's port disconnect must retire observation.
				if (!popup.isClosed()) await popup.close();
				expect(popup.isClosed()).toBe(true);
			}
			const releaseDeadline = Date.now() + 5_000;
			let status = await readRuntimeStatus(options, tabId);
			while (status.ready && Date.now() < releaseDeadline) {
				await new Promise((resolveWait) => setTimeout(resolveWait, 25));
				status = await readRuntimeStatus(options, tabId);
			}

			expect(status.ready).toBe(false);
			expect(status.runtimeRevision).toBeNull();
			await rendererClient.send('HeapProfiler.collectGarbage');
			const metrics = (await rendererClient.send('Performance.getMetrics')).metrics;
			const taskDuration = metricValue(metrics, 'TaskDuration');
			const scriptDuration = metricValue(metrics, 'ScriptDuration');
			const threadTime = metricValue(metrics, 'ThreadTime');
			const taskDeltaMs = Math.max(0, (taskDuration - previousTaskDuration) * 1_000);
			const scriptDeltaMs = Math.max(0, (scriptDuration - previousScriptDuration) * 1_000);
			const threadDeltaMs = Math.max(0, (threadTime - previousThreadTime) * 1_000);
			previousTaskDuration = taskDuration;
			previousScriptDuration = scriptDuration;
			previousThreadTime = threadTime;
			const longTasks = await mediaPage.evaluate(() => {
				const state = (window as Window & {
					__spectraLongTaskProbe?: { entries: number[]; cursor: number };
				}).__spectraLongTaskProbe;
				if (!state) throw new Error('Long-task probe is missing');
				const current = state.entries.slice(state.cursor);
				state.cursor = state.entries.length;
				return {
					count: current.length,
					duration: current.reduce((sum, value) => sum + value, 0),
				};
			});
			const contextCount = await options.evaluate(async () => (await chrome.runtime.getContexts({})).length);

			samples.push(
				{ metric: 'spectra.hotkey.long-session.batch20-e2e', value: batchElapsed, unit: 'ms' },
				{ metric: 'spectra.hotkey.long-session.heap-used', value: metricValue(metrics, 'JSHeapUsedSize'), unit: 'bytes' },
				{ metric: 'spectra.hotkey.long-session.dom-nodes', value: metricValue(metrics, 'Nodes'), unit: 'count' },
				{ metric: 'spectra.hotkey.long-session.extension-contexts', value: contextCount, unit: 'count' },
				{ metric: 'spectra.hotkey.long-session.renderer-task-time', value: taskDeltaMs, unit: 'ms' },
				{ metric: 'spectra.hotkey.long-session.renderer-script-time', value: scriptDeltaMs, unit: 'ms' },
				{ metric: 'spectra.hotkey.long-session.renderer-thread-time', value: threadDeltaMs, unit: 'ms' },
				{ metric: 'spectra.hotkey.long-session.long-task-count', value: longTasks.count, unit: 'count' },
				{ metric: 'spectra.hotkey.long-session.long-task-duration', value: longTasks.duration, unit: 'ms' },
				{ metric: 'spectra.hotkey.long-session.runtime-retained', value: status.ready ? 1 : 0, unit: 'count' },
			);
		}

		for (const metric of [
			'spectra.hotkey.long-session.batch20-e2e',
			'spectra.hotkey.long-session.heap-used',
			'spectra.hotkey.long-session.dom-nodes',
			'spectra.hotkey.long-session.extension-contexts',
			'spectra.hotkey.long-session.renderer-task-time',
			'spectra.hotkey.long-session.renderer-script-time',
			'spectra.hotkey.long-session.renderer-thread-time',
			'spectra.hotkey.long-session.long-task-count',
			'spectra.hotkey.long-session.long-task-duration',
			'spectra.hotkey.long-session.runtime-retained',
		]) {
			expect(samples.filter((sample) => sample.metric === metric)).toHaveLength(BATCH_COUNT);
		}
		writeRuntimePerformanceEvidence({
			product: 'spectra',
			browser: { name: 'Chrome', version: browserVersion },
			samples,
			profile: {
				id: 'spectra-hotkey-long-session',
				scenario: 'twenty hotkey batches with runtime release and renderer diagnostics',
				isolation: 'single-profile-long-session',
				businessAssertions: ['hotkey-applied', 'runtime-released', 'popup-closed', 'diagnostics-readable'],
			},
			outputPath: OUTPUT_PATH,
			identity: runtimePerformanceIdentityFromEnvironment(),
		});
	} finally {
		await rendererClient?.send('HeapProfiler.disable').catch(() => undefined);
		await rendererClient?.send('Performance.disable').catch(() => undefined);
		await rendererClient?.detach().catch(() => undefined);
		await browser?.close().catch(() => undefined);
		server?.stop(true);
		await rm(profileDir, {
			force: true,
			recursive: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
}, 240_000);
