import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type CDPSession, type Target } from 'puppeteer';
import {
	runtimePerformanceIdentityFromEnvironment,
	runtimePerformanceOutputPath,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
const SAMPLE_COUNT = 20;
const OUTPUT_PATH = runtimePerformanceOutputPath('spectra-worker-wake.json');
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

interface WorkerVersion {
	scriptURL: string;
	runningStatus: string;
	versionId: string;
	registrationId: string;
}

function waitForWorkerVersion(
	client: CDPSession,
	predicate: (version: WorkerVersion) => boolean,
	timeoutMs = 10_000,
): Promise<WorkerVersion> {
	return new Promise((resolveVersion, reject) => {
		const timer = setTimeout(() => {
			client.off('ServiceWorker.workerVersionUpdated', onUpdate);
			reject(new Error('Timed out waiting for SPECTRA service-worker version state'));
		}, timeoutMs);
		const onUpdate = (event: { versions: WorkerVersion[] }) => {
			const version = event.versions.find(predicate);
			if (!version) return;
			clearTimeout(timer);
			client.off('ServiceWorker.workerVersionUpdated', onUpdate);
			resolveVersion(version);
		};
		client.on('ServiceWorker.workerVersionUpdated', onUpdate);
	});
}

test('records twenty browser-owned MV3 service-worker wake samples', async () => {
	const profileDir = await mkdtemp(join(tmpdir(), 'spectra-worker-wake-'));
	let browser: Browser | null = null;
	let client: CDPSession | null = null;
	try {
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
		const controlPage = await browser.newPage();
		await controlPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		client = await controlPage.createCDPSession();
		const workerScriptUrl = `chrome-extension://${extensionId}/background.js`;
		const initialRunning = waitForWorkerVersion(
			client,
			(version) => version.scriptURL === workerScriptUrl && version.runningStatus === 'running',
		);
		await client.send('ServiceWorker.enable');
		let runningVersion = await initialRunning;
		const samples: RuntimePerformanceSample[] = [];

		for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
			const stopped = waitForWorkerVersion(
				client,
				(version) => version.versionId === runningVersion.versionId && version.runningStatus === 'stopped',
			);
			await Promise.all([
				client.send('ServiceWorker.stopWorker', { versionId: runningVersion.versionId }),
				stopped,
			]);

			const runningAgain = waitForWorkerVersion(
				client,
				(version) => version.scriptURL === workerScriptUrl && version.runningStatus === 'running',
			);
			const started = performance.now();
			let workerRunningAt = Number.NaN;
			const runningPromise = runningAgain.then((version) => {
				workerRunningAt = performance.now();
				return version;
			});
			const responsePromise = controlPage.evaluate(async () => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.settings.get',
				payload: {},
			}));
			const [nextVersion, response] = await Promise.all([runningPromise, responsePromise]);
			const responseAt = performance.now();
			if (!response?.ok) throw new Error(response?.error?.message ?? 'Worker-wake settings RPC failed');
			expect(Number.isFinite(workerRunningAt)).toBe(true);
			samples.push({
				metric: 'spectra.service-worker.stopped-to-running',
				value: workerRunningAt - started,
				unit: 'ms',
			});
			samples.push({
				metric: 'spectra.service-worker.stopped-to-rpc-response',
				value: responseAt - started,
				unit: 'ms',
			});
			runningVersion = nextVersion;
		}

		expect(samples).toHaveLength(SAMPLE_COUNT * 2);
		writeRuntimePerformanceEvidence({
			product: 'spectra',
			browser: { name: 'Chrome', version: browserVersion },
			samples,
			outputPath: OUTPUT_PATH,
			identity: runtimePerformanceIdentityFromEnvironment(),
		});
	} finally {
		await client?.send('ServiceWorker.disable').catch(() => undefined);
		await client?.detach().catch(() => undefined);
		await browser?.close().catch(() => undefined);
		await rm(profileDir, {
			force: true,
			recursive: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
}, 180_000);
