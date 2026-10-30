import { describe, expect, test } from 'bun:test';
import type {
	ControlFieldStates,
	ControlIntent,
	ControlSnapshot,
	MediaTarget,
} from '@nexus/contracts';
import {
	applyMutation,
	assertAppliedFields,
	assignFieldState,
	controlSessionScopeForSource,
	createIntent,
	defaultControlValue,
	nativeObservationFields,
	projectControlSessionPatch,
	projectControlTarget,
	sameMediaTarget,
	normalizeMutationValue,
} from '../src/background/control-coordinator-values';

const audioTarget: MediaTarget = {
	documentId: 'document-1',
	frameId: 0,
	mediaId: 'audio-1',
	sourceRevision: 1,
	kind: 'audio',
};

const videoTarget: MediaTarget = {
	documentId: 'document-1',
	frameId: 0,
	mediaId: 'video-1',
	sourceRevision: 1,
	kind: 'video',
};

const snapshot: ControlSnapshot = {
	tabId: 7,
	documentId: 'document-1',
	origin: 'https://media.example',
	generation: 2,
	revision: 4,
	activeMedia: audioTarget,
	activeVideo: videoTarget,
	fields: {},
};

function intent(patch: ControlIntent['patch']): ControlIntent {
	return createIntent(snapshot, {
		tabId: snapshot.tabId,
		source: 'popup',
		requestedCoverage: 'active-target',
		target: audioTarget,
		patch,
	}, 'intent-5');
}

describe('control coordinator pure values', () => {
	test('projects target identity only for the capability scope that owns it', () => {
		const changedAudio: MediaTarget = { ...audioTarget, mediaId: 'audio-2' };
		const changedVideo: MediaTarget = { ...videoTarget, mediaId: 'video-2' };
		expect(projectControlTarget(snapshot, ['volumeBase'], changedAudio)).toEqual({
			activeMedia: changedAudio,
			activeVideo: videoTarget,
		});
		expect(projectControlTarget(snapshot, ['video-effects-toggle'], changedVideo)).toEqual({
			activeMedia: audioTarget,
			activeVideo: changedVideo,
		});
	});

	test('compares the complete target generation identity', () => {
		expect(sameMediaTarget(audioTarget, { ...audioTarget })).toBe(true);
		expect(sameMediaTarget(audioTarget, { ...audioTarget, sourceRevision: 2 })).toBe(false);
		expect(sameMediaTarget(audioTarget, videoTarget)).toBe(false);
	});

	test('normalizes mutation values and returns isolated defaults', () => {
		expect(normalizeMutationValue('speed', 1.234)).toBe(1.23);
		expect(applyMutation(95, { field: 'volumeBase', operation: 'delta', value: 20 })).toBe(115);
		expect(applyMutation(790, { field: 'volumeBase', operation: 'delta', value: 20 })).toBe(800);
		expect(applyMutation(false, { field: 'mediaMuted', operation: 'toggle' })).toBe(true);
		const defaults = defaultControlValue('eqValues');
		(defaults as number[])[0] = 7;
		expect(defaultControlValue('eqValues')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	});

	test('keeps Chrome and page ACK projections explicit and testable', () => {
		const chromeFields: ControlFieldStates = {};
		assignFieldState(chromeFields, 'tabMuted', true, false, 5, 'intent-5');
		expect(chromeFields.tabMuted).toMatchObject({
			phase: 'error',
			strategy: 'chrome-native',
			controlled: false,
			lastError: { code: 'readback-mismatch', retryable: true },
		});
		const observed = nativeObservationFields(
			{ patch: { volumeBase: 80 }, observedStrategies: { volumeBase: 'page-native' } },
			5,
		);
		expect(observed.volumeBase).toMatchObject({
			actual: 80,
			phase: 'applied',
			strategy: 'page-native',
			coverage: 'active-target',
		});
	});

	test('projects only acknowledged session fields and preserves source scope', () => {
		const fields = nativeObservationFields(
			{ patch: { volumeBase: 80 }, observedStrategies: { volumeBase: 'dom-native' } },
			5,
		);
		expect(projectControlSessionPatch(fields)).toEqual({ volumeBase: 80 });
		expect(controlSessionScopeForSource('popup')).toBe('origin');
		expect(controlSessionScopeForSource('page')).toBe('resource');
		expect(controlSessionScopeForSource('restore')).toBe('none');
	});

	test('builds operation-independent intents and rejects missing ACK fields', () => {
		const created = intent({ speed: 1.5 });
		expect(created).toMatchObject({
			intentId: 'intent-5',
			tabId: 7,
			documentId: 'document-1',
			generation: 2,
			baseRevision: 4,
		});
		expect(() => assertAppliedFields({}, ['speed'], 'Test ACK')).toThrow(
			'Test ACK failed for speed: missing actual field acknowledgement',
		);
	});
});
