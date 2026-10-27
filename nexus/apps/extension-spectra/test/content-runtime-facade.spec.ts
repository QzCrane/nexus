import { describe, expect, test } from 'bun:test';
import {
	SPECTRA_PROTOCOL_VERSION,
	compileEffectiveVolume as canonicalCompileEffectiveVolume,
	requiresAudioProcessor as canonicalRequiresAudioProcessor,
	resolveDesiredAudioMode as canonicalResolveDesiredAudioMode,
	splitEffectiveVolume as canonicalSplitEffectiveVolume,
} from '../../../packages/contracts/src/index.ts';
import {
	compileEffectiveVolume,
	requiresAudioProcessor,
	resolveDesiredAudioMode,
	splitEffectiveVolume,
} from '../../../packages/contracts/src/spectra.content-runtime.ts';

const CONTENT_RUNTIME_VALUE_EXPORTS = [
	'CONTROL_VALUE_LIMITS',
	'DEFAULT_AUDIO_CONFIG',
	'DEFAULT_HOTKEY_SETTINGS',
	'HOTKEY_ACTION_DESCRIPTORS',
	'SPECTRA_CONTENT_RUNTIME_REVISION',
	'SPECTRA_PROTOCOL_VERSION',
	'audioConfigToProcessorConfig',
	'clampControlValue',
	'compileEffectiveVolume',
	'createSpectraEvent',
	'createSpectraRequest',
	'createBoundedSet',
	'findBestHostnameMatch',
	'isAudioConfig',
	'isDefaultAudioConfig',
	'isFiniteControlValue',
	'isHotkeyAction',
	'isHotkeyParamsForAction',
	'isMediaTarget',
	'isSpectraDefaultHotkeyKeyCombo',
	'isSpectraEventEnvelope',
	'isSpectraRequestEnvelope',
	'isSpectraResponse',
	'normalizeHostname',
	'requiresAudioProcessor',
	'resolveAudioVolume',
	'resolveAudioVolumeState',
	'resolveDesiredAudioMode',
	'resolveSpectraDefaultHotkeyAction',
	'resolveSpectraHotkeyActualFeedback',
	'rpcFailure',
	'rpcSuccess',
	'selectHotkeyFeedbackOwner',
	'selectHotkeyRepeatPolicy',
	'splitEffectiveVolume',
] as const;

describe('Content contracts facade boundary', () => {
	test('re-exports audio policy and volume helpers by canonical identity', () => {
		expect(requiresAudioProcessor).toBe(canonicalRequiresAudioProcessor);
		expect(resolveDesiredAudioMode).toBe(canonicalResolveDesiredAudioMode);
		expect(compileEffectiveVolume).toBe(canonicalCompileEffectiveVolume);
		expect(splitEffectiveVolume).toBe(canonicalSplitEffectiveVolume);
	});

	test('keeps the facade closed and prevents forbidden canonical-surface leakage', async () => {
		const facade = await import('../../../packages/contracts/src/spectra.content-runtime.ts');
		expect(Object.keys(facade).sort()).toEqual([...CONTENT_RUNTIME_VALUE_EXPORTS].sort());
		for (const forbidden of [
			'isLegacyAudioConfig',
			'normalizeLegacyAudioConfig',
			'isAudioProcessorConfig',
			'isAudioConfigPatch',
			'audioSessionMatchesIdentity',
			'audioSessionMatchesControlDocument',
			'isActiveCaptureLifecycle',
			'CONTROL_ALGORITHM_POLICIES',
			'createSiteRouteFingerprint',
			'Actions',
		]) {
			expect(Object.hasOwn(facade, forbidden), `${forbidden} must stay outside Content`).toBe(false);
		}
	});

	test('accepts the acknowledgements Content actually receives', async () => {
		const facade = await import('../../../packages/contracts/src/spectra.content-runtime.ts');
		// Both types were issued from Content while this facade returned false for
		// them, so the shipped Content bundle rejected every well-formed answer. The
		// complete protocol module accepted the same payloads, which is why unit
		// tests never noticed.
		expect(facade.isSpectraResponse('spectra.audio.page-scale.record', {
			ok: true, data: { recorded: true },
		})).toBe(true);
		expect(facade.isSpectraResponse('spectra.content.default-hotkey.trigger', {
			ok: true, data: { accepted: true },
		})).toBe(true);
		// Narrowing the guard must not become accepting anything that answers.
		expect(facade.isSpectraResponse('spectra.audio.page-scale.record', {
			ok: true, data: { recorded: false },
		})).toBe(false);
		expect(facade.isSpectraResponse('spectra.content.default-hotkey.trigger', {
			ok: true, data: { accepted: 'yes' },
		})).toBe(false);
	});

	test('answers navigation URL validity identically in both protocol entries', async () => {
		const facade = await import('../../../packages/contracts/src/spectra.content-runtime.ts');
		const full = await import('../../../packages/contracts/src/spectra.protocol.ts');
		// A 5000-character query is still a navigation the browser can commit to.
		// The slim entry used to stop at 4096 and skip URL parsing entirely, so the
		// same event was legal for Background and malformed for Content (SP-67).
		const longButValid = `https://media.example/watch?q=${'a'.repeat(5_000)}`;
		const event = (url: string) => ({
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.navigation.changed',
			tabId: 7,
			documentId: 'document-navigation',
			payload: { url },
		});
		for (const url of [longButValid, 'not-a-url', '', `https://media.example/${'a'.repeat(9_000)}`]) {
			expect(facade.isSpectraEventEnvelope(event(url)), url.slice(0, 40)).toBe(
				full.isSpectraEventEnvelope(event(url)),
			);
		}
		expect(facade.isSpectraEventEnvelope(event(longButValid))).toBe(true);
	});

});
