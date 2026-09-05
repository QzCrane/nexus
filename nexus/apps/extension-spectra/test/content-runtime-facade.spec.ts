import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const facadePath = resolve(
	import.meta.dir,
	'../../../packages/contracts/src/spectra.content-runtime.ts',
);
const buildPath = resolve(import.meta.dir, '../build.ts');

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
	'crossesAudioVolumeRoutingBoundary',
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

		const facade = readFileSync(facadePath, 'utf8');
		expect(facade).toMatch(
			/import \{[\s\S]*requiresAudioProcessor[\s\S]*\} from '\.\/audio\.contracts\.js';/u,
		);
		expect(facade).toMatch(
			/import \{[\s\S]*resolveDesiredAudioMode[\s\S]*\} from '\.\/audio\.contracts\.js';/u,
		);
		expect(facade).toMatch(
			/import \{[\s\S]*compileEffectiveVolume[\s\S]*\} from '\.\/control-value-limits\.js';/u,
		);
		expect(facade).toMatch(
			/import \{[\s\S]*splitEffectiveVolume[\s\S]*\} from '\.\/control-value-limits\.js';/u,
		);
		expect(facade).not.toContain("from './index.js'");
		expect(facade).not.toContain('export *');
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

	test('routes production Content entries through the restricted facade alias', () => {
		const build = readFileSync(buildPath, 'utf8');
		expect(build).toContain("'@nexus/contracts': contentContractsRuntime");
		expect(build).toContain("'@nexus/contracts': resolve(projectDir, '../../packages/contracts/src/index.ts')");
		expect(build).toContain("plugins: [contractRuntimeFacadePlugin()]");
	});
});
