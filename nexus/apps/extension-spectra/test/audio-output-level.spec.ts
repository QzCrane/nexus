// goal: document-output gain and mute have independent physical proof without changing legacy Boost
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import type { Browser } from 'puppeteer';
import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { isAudioProcessorConfig } from '../../../packages/contracts/src/audio-processor.contracts';
import {
	audioConfigToProcessorConfig, DEFAULT_AUDIO_CONFIG, isAudioConfig, isAudioConfigPatch,
	isDefaultAudioConfig, isLegacyAudioConfig, requiresAudioProcessor, resolveDesiredAudioMode,
} from '../../../packages/contracts/src/audio.contracts';
import { DEFAULT_AUDIO_GRAPH_CONFIG, normalizeAudioGraphConfig } from '../../../packages/features/audio-engine/src/audio-graph-router';
import { testChrome } from './helpers/chrome-integration';
import { isAudioSitePolicy, isSettingsPatchRequest } from '../../../packages/contracts/src/settings.contracts';

test('document output ownership cannot be imported as a site or preset preference', () => {
	for (const documentOutput of [undefined, true] as const) {
		const config = { ...DEFAULT_AUDIO_CONFIG, ...(documentOutput ? { documentOutput } : {}) };
		expect(isAudioSitePolicy({ config, mediaRoute: 'auto' })).toBe(documentOutput === undefined);
		expect(isSettingsPatchRequest({ expectedRevision: 0, patch: {
			scope: 'audio-site', domain: 'example.com', value: config,
		} })).toBe(documentOutput === undefined);
		expect(isSettingsPatchRequest({ expectedRevision: 0, patch: {
			scope: 'audio-preset', name: 'Saved', value: { config, meta: { type: 'global', name: 'Saved', createdAt: 1 } },
		} })).toBe(documentOutput === undefined);
	}
});

test('admits only a bounded, strict document-output level and preserves the legacy Boost contract', () => {
	const base = DEFAULT_AUDIO_GRAPH_CONFIG;
	expect(isAudioProcessorConfig(base)).toBe(true);
	for (const gain of [0, 0.3, 0.7, 1, 2, 8]) {
		for (const muted of [false, true]) expect(isAudioProcessorConfig({ ...base, outputLevel: { gain, muted } })).toBe(true);
	}
	for (const outputLevel of [null, {}, { gain: 1 }, { gain: 1, muted: 0 },
		{ gain: -0.1, muted: false }, { gain: 8.1, muted: false },
		{ gain: Number.NaN, muted: false }, { gain: Number.POSITIVE_INFINITY, muted: false },
		{ gain: 1, muted: false, nativeVolume: 50 }]) {
		expect(isAudioProcessorConfig({ ...base, outputLevel })).toBe(false);
	}
	expect(isAudioProcessorConfig({ ...base, outputLevel: { gain: 1, muted: false }, volume: 30 })).toBe(false);
	expect(isAudioProcessorConfig({ ...base, boostGain: 0 })).toBe(false);
	expect(normalizeAudioGraphConfig(base)).toEqual(base);
	expect(normalizeAudioGraphConfig({ ...base, boostGain: 7, outputLevel: { gain: 0.7, muted: true } }))
		.toMatchObject({ boostGain: 1, outputLevel: { gain: 0.7, muted: true } });
});

test('document-output ownership is explicit runtime demand and never a legacy preference', () => {
	const output = { ...DEFAULT_AUDIO_CONFIG, volume: 30, volumeBase: 30, documentOutput: true as const };
	expect(isAudioConfig(output)).toBe(true);
	expect(isAudioConfigPatch({ documentOutput: true })).toBe(true);
	expect(isAudioConfig({ ...output, documentOutput: false })).toBe(false);
	expect(isAudioConfigPatch({ documentOutput: 'capture' })).toBe(false);
	expect(isLegacyAudioConfig(output)).toBe(false);
	expect(isDefaultAudioConfig({ ...DEFAULT_AUDIO_CONFIG, documentOutput: true })).toBe(false);
	expect(requiresAudioProcessor(output)).toBe(true);
	expect(resolveDesiredAudioMode(output, { visualizer: false, mediaWebAudio: true, mediaRoute: 'direct' })).toBe('capture');
	expect(resolveDesiredAudioMode({ ...output, enabled: false })).toBe('bypass');
	expect(audioConfigToProcessorConfig(output)).toMatchObject({ boostGain: 1, outputLevel: { gain: 0.3, muted: false } });
	expect(audioConfigToProcessorConfig({ ...DEFAULT_AUDIO_CONFIG, volume: 30, volumeBase: 30 }))
		.not.toHaveProperty('outputLevel');
});

testChrome('renders document levels, independent mute and legacy Boost release through the production graph', async () => {
	const bundle = await build({
		entryPoints: [resolve(import.meta.dir, '../../../packages/features/audio-engine/src/audio-graph-router.ts')],
		bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AudioGraph',
	});
	const code = bundle.outputFiles?.[0]?.text;
	if (!code) throw new Error('Production graph bundle is missing');
	const profilePath = await mkdtemp(join(tmpdir(), 'spectra-output-level-'));
	let browser: Browser | null = null;
	try {
		const executablePath = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
		browser = await launchPuppeteerBrowser({
			...(executablePath ? { executablePath } : {}), headless: true, userDataDir: profilePath,
			args: ['--autoplay-policy=no-user-gesture-required'],
		}, {
			owner: 'apps/extension-spectra/test/audio-output-level.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-output-level-', isolated: true },
		});
		const page = await browser.newPage();
		await page.addScriptTag({ content: code });
		const result = await page.evaluate(async () => {
			const { AudioGraphRouter, DEFAULT_AUDIO_GRAPH_CONFIG } = (window as Window & {
				AudioGraph: typeof import('../../../packages/features/audio-engine/src/audio-graph-router');
			}).AudioGraph;
			const context = new AudioContext();
			await context.resume();
			const analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			analyser.connect(context.destination);
			const router = new AudioGraphRouter(context, analyser, { crossfadeMs: 0 });
			const oscillator = context.createOscillator();
			oscillator.frequency.value = 1000;
			const amplitude = context.createGain();
			amplitude.gain.value = 0.1;
			oscillator.connect(amplitude);
			router.connectSource(amplitude);
			oscillator.start();
			const signal = async () => {
				// Discard the analyser's pre-write window; do not wait for an expected value.
				await new Promise(resolveWait => setTimeout(resolveWait, 70));
				const values = new Float32Array(analyser.fftSize);
				let energy = 0;
				for (let window = 0; window < 8; window++) {
					analyser.getFloatTimeDomainData(values);
					for (const value of values) energy += value * value;
					await new Promise(resolveWait => setTimeout(resolveWait, 25));
				}
				return Math.sqrt(energy / (8 * values.length));
			};
			try {
				const samples: Array<{ gain: number; rms: number; actual: { gain: number; muted: boolean } | undefined }> = [];
				for (const gain of [0, 0.3, 0.7, 1, 2]) {
					const snapshot = await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG,
						boostGain: 7, outputLevel: { gain, muted: false } }, { requireRunning: true });
					samples.push({ gain, rms: await signal(), actual: snapshot.normalizedActualConfig.outputLevel });
				}
				const mute = await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG,
					outputLevel: { gain: 0.7, muted: true } }, { requireRunning: true });
				const mutedRms = await signal();
				const unmute = await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG,
					outputLevel: { gain: 0.7, muted: false } }, { requireRunning: true });
				const unmutedRms = await signal();
				const boost = await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG, boostGain: 2 }, { requireRunning: true });
				const boostRms = await signal();
				const bypass = await router.bypass({ requireRunning: true });
				return { samples, mutedRms, unmutedRms, boostRms, bypassRms: await signal(),
					mute: mute.normalizedActualConfig, unmute: unmute.normalizedActualConfig,
					boost: boost.normalizedActualConfig, bypass: bypass.normalizedActualConfig };
			} finally {
				oscillator.stop();
				await router.dispose();
				await context.close();
			}
		});
		for (const sample of result.samples) {
			expect(sample.actual?.gain).toBeCloseTo(sample.gain, 6);
			expect(sample.actual?.muted).toBe(false);
			expect(sample.rms).toBeCloseTo(0.1 * sample.gain / Math.sqrt(2), 3);
		}
		expect(result.mute.outputLevel?.gain).toBeCloseTo(0.7, 6);
		expect(result.mute.outputLevel?.muted).toBe(true);
		expect(result.unmute.outputLevel?.gain).toBeCloseTo(0.7, 6);
		expect(result.unmute.outputLevel?.muted).toBe(false);
		expect(result.mutedRms).toBeLessThan(0.000_001);
		expect(result.unmutedRms).toBeCloseTo(0.07 / Math.sqrt(2), 3);
		expect(result.boost).toMatchObject({ boostGain: 2 });
		expect(result.boost).not.toHaveProperty('outputLevel');
		expect(result.boostRms).toBeCloseTo(0.2 / Math.sqrt(2), 3);
		expect(result.bypass).not.toHaveProperty('outputLevel');
		expect(result.bypassRms).toBeCloseTo(0.1 / Math.sqrt(2), 3);
	} finally {
		await browser?.close();
		await rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}, 20_000);
