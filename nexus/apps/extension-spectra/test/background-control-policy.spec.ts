import { describe, expect, test } from 'bun:test';
import {
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_CAPABILITIES,
	CONTROL_FIELDS,
	CONTROL_SESSION_FIELDS,
	resolveAcknowledgedAudioVolumeState,
	resolveControlAudioVolume,
	type ControlFieldStates,
} from '@nexus/contracts';
import {
	BACKGROUND_PROCESSOR_FIELDS,
	backgroundControlTargetScopeFlags,
	backgroundResolveAcknowledgedAudioVolumeState,
	backgroundResolveControlAudioVolume,
	backgroundRestoreBucket,
} from '../src/background/background-control-policy';

describe('Background control policy projection', () => {
	test('matches canonical target-scope semantics for every capability', () => {
		for (const capability of CONTROL_CAPABILITIES) {
			const scope = CONTROL_ALGORITHM_POLICIES[capability].scope;
			expect(backgroundControlTargetScopeFlags([capability])).toEqual({
				updatesMedia: scope === 'active-media'
					|| scope === 'media-source'
					|| scope === 'requested-audio-scope',
				updatesVideo: scope === 'active-video',
			});
		}
	});

	test('matches canonical document-restore routing for every session field', () => {
		for (const field of CONTROL_SESSION_FIELDS) {
			const policy = CONTROL_ALGORITHM_POLICIES[field];
			const expected = policy.scope === 'active-video'
				? 'video'
				: policy.scope === 'document'
					|| policy.orderedStrategies.some((strategy) => (
						strategy === 'media-webaudio' || strategy === 'capture'
					))
					? 'full'
					: 'media';
			expect(backgroundRestoreBucket(field)).toBe(expected);
		}
	});

	test('matches the canonical processor-readback field set', () => {
		const expected = CONTROL_FIELDS.filter((field) =>
			CONTROL_ALGORITHM_POLICIES[field].acknowledgements.includes('processor-readback'));
		expect([...BACKGROUND_PROCESSOR_FIELDS]).toEqual(expected);
	});

	test('matches canonical acknowledged audio-volume projection semantics', () => {
		const cases: ControlFieldStates[] = [
			{
				volumeBase: { desired: 100, actual: 100, revision: 1, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
				boost: { desired: 2, actual: 2, revision: 1, phase: 'applied', strategy: 'capture', coverage: 'full', controlled: true, lastError: null },
				mediaMuted: { desired: false, actual: false, revision: 1, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
			},
			{
				volumeBase: { desired: 80, actual: 80, revision: 3, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
				boost: { desired: 1.5, actual: 1.5, revision: 3, phase: 'applied', strategy: 'media-webaudio', coverage: 'full', controlled: true, lastError: null },
				mediaMuted: { desired: false, actual: false, revision: 3, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
			},
			{
				volumeBase: { desired: 100, actual: 100, revision: 5, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
				boost: { desired: 1, actual: 1, revision: 5, phase: 'idle', strategy: 'observe', coverage: 'full', controlled: false, lastError: null },
				mediaMuted: { desired: false, actual: false, revision: 5, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
			},
			{
				volumeBase: { desired: 100, actual: 100, revision: 9, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
				boost: { desired: 2, actual: 2, revision: 8, phase: 'applied', strategy: 'capture', coverage: 'full', controlled: true, lastError: null },
				eqValues: { desired: [], actual: [], revision: 9, phase: 'idle', strategy: 'observe', coverage: 'full', controlled: false, lastError: null },
				mediaMuted: { desired: true, actual: true, revision: 9, phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null },
			},
			{},
		];

		for (const fields of cases) {
			expect(backgroundResolveControlAudioVolume(fields)).toEqual(resolveControlAudioVolume(fields));
		for (const [volume, muted] of [[0, false], [100, false], [200, false], [200, true]] as const) {
				expect(backgroundResolveAcknowledgedAudioVolumeState(fields, volume, muted))
					.toBe(resolveAcknowledgedAudioVolumeState(fields, volume, muted));
			}
		}
	});
});
