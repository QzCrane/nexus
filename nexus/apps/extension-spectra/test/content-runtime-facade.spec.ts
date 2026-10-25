import { describe, expect, test } from 'bun:test';
import {
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
});
