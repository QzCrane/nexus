import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAudioProcessorConfig } from '@nexus/contracts';

const processorConfig = {
	boostGain: 1,
	compressor: false,
	mono: false,
	bass: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	pan: 0,
	delay: 0,
};

describe('Audio processor contract boundary', () => {
	test('accepts only the exact Capture graph state and excludes native media fields', () => {
		expect(isAudioProcessorConfig(processorConfig)).toBe(true);
		expect(isAudioProcessorConfig({ ...processorConfig, muted: false })).toBe(false);
		expect(isAudioProcessorConfig({ ...processorConfig, volume: 100 })).toBe(false);
		expect(isAudioProcessorConfig({ ...processorConfig, speed: 1 })).toBe(false);
		expect(isAudioProcessorConfig({ ...processorConfig, boostGain: 0 })).toBe(false);
		expect(isAudioProcessorConfig({ ...processorConfig, eqValues: [0] })).toBe(false);
	});

	test('keeps one lightweight runtime owner behind the existing public facade', () => {
		const contractsDir = resolve(import.meta.dir, '../../../packages/contracts/src');
		const audio = readFileSync(resolve(contractsDir, 'audio.contracts.ts'), 'utf8');
		const index = readFileSync(resolve(contractsDir, 'index.ts'), 'utf8');
		const offscreen = readFileSync(resolve(contractsDir, 'offscreen.contracts.ts'), 'utf8');
		expect(index).toContain("export { isAudioProcessorConfig } from './audio-processor.contracts.js';");
		expect(audio).not.toContain('export function isAudioProcessorConfig(');
		expect(audio).not.toContain("export { isAudioProcessorConfig }");
		expect(offscreen).toContain("from './audio-processor.contracts.js';");
		expect(offscreen).not.toContain("from './audio.contracts.js';");
	});
});
