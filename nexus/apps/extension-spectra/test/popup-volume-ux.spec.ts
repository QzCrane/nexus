import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	audioSessionMatchesIdentity,
	audioSessionMatchesControlDocument,
	DEFAULT_AUDIO_CONFIG,
	resolveAudioVolumeState,
} from '@nexus/contracts';
import { COLORS } from '../src/popup/constants';
import { actualVolumeColor } from '../src/popup/card/render';
import { mergeAudioConfig } from '../src/popup/card/types';

describe('Popup single effective-volume control', () => {
	test('exposes exactly one 0-800 slider and no implementation-level Boost control', () => {
		const html = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		expect(html.match(/class="vol-slider"/gu)).toHaveLength(1);
		expect(html).toContain('class="vol-slider"');
		expect(html).toMatch(/class="vol-slider"[\s\S]*?min="0"[\s\S]*?max="800"/u);
		expect(html).not.toContain('boost-slider');
		expect(html).not.toContain('Audio boost');
	});

	test('projects the one value to native volume and hidden Boost without changing the product value', () => {
		const native = mergeAudioConfig(DEFAULT_AUDIO_CONFIG, { volume: 65 });
		expect(native).toMatchObject({ volume: 65, volumeBase: 65, boost: 1 });

		const enhanced = mergeAudioConfig(native, { volume: 350 });
		expect(enhanced).toMatchObject({ volume: 350, volumeBase: 100, boost: 3.5 });
	});

	test('derives color only from acknowledged capture state, never from volume threshold', () => {
		expect(actualVolumeColor(false, 350, 'bypass', 'active')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 350, 'capture', 'starting')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 80, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(actualVolumeColor(false, 350, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(actualVolumeColor(true, 350, 'capture', 'active')).toBe(COLORS.MUTED);
		expect(actualVolumeColor(false, 0, 'capture', 'active')).toBe(COLORS.MUTED);
	});

	test('uses one volume-state truth table and fails closed on stale document identity', () => {
		expect(resolveAudioVolumeState({
			volume: 80, muted: false, actualMode: 'capture', phase: 'active',
		})).toBe('capture');
		expect(resolveAudioVolumeState({
			volume: 350, muted: false, actualMode: 'bypass', phase: 'active',
		})).toBe('native');
		expect(resolveAudioVolumeState({
			volume: 350, muted: false, actualMode: 'capture', phase: 'error',
		})).toBe('native');
		expect(resolveAudioVolumeState({
			volume: 0, muted: false, actualMode: 'capture', phase: 'active',
		})).toBe('silent');

		const identity = {
			tabId: 17, documentId: 'document-current', origin: 'https://media.example', generation: 9,
		};
		expect(audioSessionMatchesIdentity(identity, identity)).toBe(true);
		expect(audioSessionMatchesIdentity(
			{ ...identity, documentId: 'document-stale' },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesIdentity(
			{ ...identity, origin: 'https://stale.example' },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesIdentity(
			{ ...identity, generation: 8 },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesControlDocument(
			{ ...identity, generation: 8 },
			identity,
		)).toBe(true);
	});
});
