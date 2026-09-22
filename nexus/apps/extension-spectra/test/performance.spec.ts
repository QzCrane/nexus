import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import type { Browser } from 'puppeteer';
import { build } from 'esbuild';
import {
	runtimePerformanceIdentityFromEnvironment,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const SAMPLE_COUNT = 20;
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME_VERSION = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

test('renders continuous audio through repeated neutral and boosted gain updates', async () => {
	const bundle = await build({
		entryPoints: [resolve(import.meta.dir, '../../../packages/features/audio-engine/src/AudioGraphRouter.ts')],
		bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AudioGraph',
	});
	const code = bundle.outputFiles?.[0]?.text;
	if (!code) throw new Error('Production audio graph bundle is missing');
	const profilePath = await mkdtemp(join(tmpdir(), 'spectra-audio-continuity-'));
	let browser: Browser | null = null;
	try {
		browser = await launchPuppeteerBrowser({
			...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
			headless: true, userDataDir: profilePath,
		}, {
			owner: 'apps/extension-spectra/test/performance.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-audio-continuity-', isolated: true },
		});
		const page = await browser.newPage();
		await page.addScriptTag({ content: code });
		const result = await page.evaluate(async () => {
			const { AudioGraphRouter, DEFAULT_AUDIO_GRAPH_CONFIG } = (window as Window & {
				AudioGraph: typeof import('../../../packages/features/audio-engine/src/AudioGraphRouter');
			}).AudioGraph;
			const context = new OfflineAudioContext(1, 24_000, 48_000);
			// OfflineAudioContext supplies the real WebAudio node factories and clock;
			// only the controller-specific realtime resume/close API is absent.
			const router = new AudioGraphRouter(context as unknown as AudioContext);
			const oscillator = context.createOscillator();
			oscillator.frequency.value = 1_000;
			const input = context.createGain();
			input.gain.value = 0.1;
			oscillator.connect(input);
			router.connectSource(input);
			await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG, eqValues: [...DEFAULT_AUDIO_GRAPH_CONFIG.eqValues] });
			oscillator.start();
			const pauses = [0.1, 0.2, 0.3].map((time) => context.suspend(time));
			const rendering = context.startRendering();
			const sources: number[] = [];
			const signatures: string[] = [];
			for (const [index, boostGain] of [1.1, 1, 1.1].entries()) {
				await pauses[index];
				const snapshot = await router.apply({
					...DEFAULT_AUDIO_GRAPH_CONFIG, boostGain,
					eqValues: [...DEFAULT_AUDIO_GRAPH_CONFIG.eqValues],
				});
				sources.push(snapshot.sourceCount);
				signatures.push(snapshot.graphSignature);
				await context.resume();
			}
			const samples = (await rendering).getChannelData(0);
			const rms = (start: number, length: number) => {
				let energy = 0;
				for (let index = start; index < start + length; index++) energy += (samples[index] ?? 0) ** 2;
				return Math.sqrt(energy / length);
			};
			let minimumQuantumRms = Number.POSITIVE_INFINITY;
			let maximumAmplitude = 0;
			for (let offset = 0; offset + 128 <= samples.length; offset += 128) {
				minimumQuantumRms = Math.min(minimumQuantumRms, rms(offset, 128));
			}
			for (const value of samples) maximumAmplitude = Math.max(maximumAmplitude, Math.abs(value));
			return { minimumQuantumRms, maximumAmplitude, finalRms: rms(19_200, 4_800), sources, signatures };
		});
		// Independent signal oracle: a 0.1-amplitude sine is 0.1/sqrt(2) RMS;
		// gain 1.1 must finish at 0.11/sqrt(2), with no silent quantum or doubling.
		expect(result.minimumQuantumRms).toBeGreaterThan(0.06);
		expect(result.maximumAmplitude).toBeLessThanOrEqual(0.111);
		expect(result.finalRms).toBeCloseTo(0.11 / Math.sqrt(2), 4);
		expect(result.sources).toEqual([1, 1, 1]);
		expect(new Set(result.signatures).size).toBe(1);
	} finally {
		await browser?.close();
		await rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}, 20_000);

async function extensionId(browser: Browser): Promise<string> {
	try {
		const target = await browser.waitForTarget(
			(candidate) => candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
			{ timeout: 10_000 },
		);
		return new URL(target.url()).hostname;
	} catch (cause) {
		const targets = browser.targets().map((target) => ({ type: target.type(), url: target.url() }));
		throw new Error(`Cold profile did not expose its extension worker: ${JSON.stringify({ extensionDir: EXTENSION_DIR, targets })}`, { cause });
	}
}

test('records twenty independent SPECTRA Popup cold-interactive samples', async () => {
	const samples: RuntimePerformanceSample[] = [];
	let observedBrowserVersion = '';

	for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
		const profilePath = await mkdtemp(join(tmpdir(), 'spectra-popup-perf-'));
		let browser: Browser | null = null;
		try {
			const coldStarted = performance.now();
			browser = await launchPuppeteerBrowser({
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
				headless: true,
				userDataDir: profilePath,
				args: [
					`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
		],
		}, {
			owner: 'apps/extension-spectra/test/performance.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-popup-perf-', isolated: true },
		});
			const currentBrowserVersion = await browser.version();
			if (EXPECTED_CHROME_VERSION && !currentBrowserVersion.includes(EXPECTED_CHROME_VERSION)) {
				throw new Error(`Expected Chrome ${EXPECTED_CHROME_VERSION}, got ${currentBrowserVersion}`);
			}
			const id = await extensionId(browser);
			const page = await browser.newPage();
			const navigationStarted = performance.now();
			await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'domcontentloaded' });
			// Observe the same user-facing readiness in both builds. The candidate's
			// private ready marker is absent from the frozen base and cannot be a
			// common benchmark oracle. Verify settings data and real navigation.
			await page.waitForFunction(() => {
				const settings = document.getElementById('btn-settings');
				return document.documentElement.lang.length > 0
					&& settings instanceof HTMLElement && typeof settings.onclick === 'function'
					&& typeof document.querySelector<HTMLInputElement>('#set-osd')?.onchange === 'function'
					&& document.getElementById('bg-badge')?.textContent?.trim() === '0'
					&& !document.getElementById('empty-state')?.classList.contains('hidden');
			}, { timeout: 10_000 });
			await page.click('#btn-settings');
			await page.waitForSelector('#view-settings.active', { visible: true, timeout: 10_000 });
			await page.click('#btn-back');
			await page.waitForSelector('#view-main.active', { visible: true, timeout: 10_000 });
			const interactiveAt = performance.now();
			samples.push({
				metric: 'spectra.popup.cold-profile-to-interactive',
				value: interactiveAt - coldStarted,
				unit: 'ms',
			});
			samples.push({
				metric: 'spectra.popup.navigation-to-interactive',
				value: interactiveAt - navigationStarted,
				unit: 'ms',
			});
			if (!observedBrowserVersion) observedBrowserVersion = currentBrowserVersion;
		} finally {
			await browser?.close();
			await rm(profilePath, {
				force: true,
				recursive: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		}
	}

	expect(samples).toHaveLength(SAMPLE_COUNT * 2);
	writeRuntimePerformanceEvidence({
		product: 'spectra',
		browser: { name: 'Chrome', version: observedBrowserVersion || 'unknown' },
		samples,
		profile: {
			id: 'spectra-popup-cold',
			scenario: 'cold profile popup readiness plus settings navigation roundtrip',
			isolation: 'fresh-profile-per-sample',
			businessAssertions: ['settings-loaded', 'empty-state-owned', 'navigation-roundtrip'],
		},
		identity: runtimePerformanceIdentityFromEnvironment(),
	});
}, 180_000);
