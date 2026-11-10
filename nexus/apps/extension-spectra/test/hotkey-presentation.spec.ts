import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, isSpectraEventEnvelope, isSpectraHotkeyPresentation, SPECTRA_PROTOCOL_VERSION,
	type ControlSnapshot } from '@nexus/contracts';
import { isSpectraEventEnvelope as isContentEvent } from '../../../packages/contracts/src/spectra.content-runtime';
import { isSpectraUiEventEnvelope } from '@nexus/contracts/ui-runtime';
import { shortcutTestApi } from '../src/background/shortcuts';
import { resolveVolumePresentation } from '../src/popup/card/render';
import type { CardInternalState } from '../src/popup/card/types';
import { COLORS } from '../src/popup/constants';

const token = { owner: 'hotkey:default:1', revision: 1 };
const event = (presentation: unknown) => ({ protocolVersion: SPECTRA_PROTOCOL_VERSION,
	type: 'spectra.hotkey.target.feedback', tabId: 7, documentId: 'doc-7',
	payload: { action: 'volume_up', targetTabId: 7, targetTitle: 'Media', targetHostname: 'media.example', presentation } });
const field = (actual: number | boolean) => ({ desired: actual, actual, revision: 1, phase: 'applied' as const,
	strategy: 'dom-native' as const, coverage: 'active-target' as const, controlled: true, lastError: null });
const snapshot = (route: ControlSnapshot['prospectiveBoostRoute']): ControlSnapshot => ({
	tabId: 7, documentId: 'doc-7', origin: 'https://media.example', generation: 1, revision: 1,
	activeMedia: null, activeVideo: null, fields: { volumeBase: field(100), mediaMuted: field(false) }, prospectiveBoostRoute: route,
} as ControlSnapshot);

describe('typed hotkey pending volume presentation', () => {
	test('accepts presentation without inventing actual feedback in all three guards', () => {
		for (const presentation of [{ phase: 'pending', token, volume: 110, tone: 'capture' }, { phase: 'settled', token }]) {
			expect(isSpectraHotkeyPresentation(presentation)).toBe(true);
			for (const guard of [isSpectraEventEnvelope, isContentEvent, isSpectraUiEventEnvelope]) expect(guard(event(presentation))).toBe(true);
			expect(event(presentation).payload).not.toHaveProperty('feedback');
		}
	});
	test('rejects malformed tokens, tones, scope and settlement fields', () => {
		for (const presentation of [
			{ phase: 'pending', token: { ...token, revision: 0 }, volume: 110, tone: 'capture' },
			{ phase: 'pending', token: { ...token, owner: '' }, volume: 110, tone: 'capture' },
			{ phase: 'pending', token, volume: 801, tone: 'capture' },
			{ phase: 'pending', token, volume: 110, tone: 'purple' },
			{ phase: 'settled', token, volume: 110 },
		]) for (const guard of [isSpectraEventEnvelope, isContentEvent, isSpectraUiEventEnvelope]) expect(guard(event(presentation))).toBe(false);
	});
	test('projects the actual serialized plan without recomputing a delta from an older snapshot', () => {
		expect(shortcutTestApi.resolveShortcutVolumePresentation(snapshot('capture'), null, { volume: 110, muted: false }))
			.toEqual({ volume: 110, tone: 'capture' });
		expect(shortcutTestApi.resolveShortcutVolumePresentation(snapshot('media-webaudio'), null, { volume: 130, muted: false }))
			.toEqual({ volume: 130, tone: 'native' });
		expect(shortcutTestApi.resolveShortcutVolumePresentation(snapshot('capture'), null, { volume: 100, muted: true }))
			.toEqual({ volume: 100, tone: 'muted' });
		expect(shortcutTestApi.resolveShortcutVolumePresentation({ ...snapshot('capture'), fields: {} }, null, { volume: 120, muted: false }))
			.toEqual({ volume: 120, tone: 'capture' });
		expect(shortcutTestApi.resolveShortcutVolumePresentation({ ...snapshot(null), fields: {
			boost: { ...field(1), strategy: 'capture' },
		} }, null, { volume: 110, muted: false })).toEqual({ volume: 110, tone: 'native' });
	});
	test('keeps the existing card on the pending tone through old lifecycle snapshots', () => {
		const config = { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
		const state = { config, actualMode: 'bypass', phase: 'idle',
			hotkeyVolumePresentation: { token, volume: 110, tone: 'capture' } } as CardInternalState;
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 110, color: COLORS.CAPTURE });
		expect(state.config).toBe(config);
		expect(state.config.volume).toBe(100);
		state.pendingVolumePresentation = { effectiveVolume: 100, muted: false, tone: 'native' };
		expect(resolveVolumePresentation(state).effectiveVolume).toBe(100);
	});
});
