import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	compileEffectiveVolume,
	CONTROL_ALGORITHM_ADJUDICATIONS,
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_CAPABILITIES,
	CONTROL_DIRECT_FIELDS,
	CONTROL_FIELDS,
	CONTROL_OPERATIONS,
	CONTROL_RETRYABLE_STRATEGY_FAILURES,
	CONTROL_STRATEGIES,
	CONTROL_STRATEGY_RULES,
	CONTROL_TERMINAL_STRATEGY_FAILURES,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	classifyControlStrategy,
	isControlIntent,
	isControlOperationAck,
	isControlPatch,
	isControlReadResult,
	isControlSnapshot,
	isControlSubmitRequest,
	isSpectraRequestEnvelope,
	shouldTryNextControlStrategy,
	splitEffectiveVolume,
	splitLegacyVolume,
	type ControlField,
	type ControlFieldState,
} from '@nexus/contracts';
import {
	CONTENT_ACTIVE_VIDEO_OPERATIONS,
	CONTENT_DOM_NATIVE_FIELDS,
	CONTENT_EXTENSION_CSS_FIELDS,
	CONTENT_EXTENSION_OVERLAY_FIELDS,
	CONTENT_PAGE_NATIVE_FIELDS,
	contentControlStrategy,
	isContentActiveVideoOperation,
} from '../src/content/logic/content-control-policy';
import {
	SPECTRA_CONTENT_RUNTIME_REVISION as CONTENT_FACADE_RUNTIME_REVISION,
	isSpectraEventEnvelope as isContentSpectraEventEnvelope,
	isSpectraRequestEnvelope as isContentSpectraRequestEnvelope,
	isSpectraResponse as isContentSpectraResponse,
} from '@nexus/contracts/content-runtime';

function field<T>(actual: T): ControlFieldState<T> {
	return {
		desired: actual,
		actual,
		revision: 4,
		phase: 'applied',
		strategy: 'dom-native',
		coverage: 'active-target',
		controlled: true,
		intentId: 'intent-4',
		lastError: null,
	};
}

describe('per-field SPECTRA control contracts', () => {
	test('splits one effective volume into native base and hidden Boost', () => {
		expect(compileEffectiveVolume(50, 2)).toBe(100);
		expect(compileEffectiveVolume(100, 8)).toBe(800);
		expect(splitEffectiveVolume(75)).toEqual({ volumeBase: 75, boost: 1 });
		expect(splitEffectiveVolume(250)).toEqual({ volumeBase: 100, boost: 2.5 });
		expect(splitLegacyVolume(250)).toEqual(splitEffectiveVolume(250));
	});

	test('accepts a routed, revisioned intent and rejects empty or out-of-range patches', () => {
		const intent = {
			intentId: 'intent-4',
			tabId: 42,
			documentId: 'document-42',
			generation: 3,
			baseRevision: 9,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: {
				frameId: 0,
				documentId: 'document-42',
				mediaId: 'media:3:1',
				sourceRevision: 2,
				kind: 'video',
			},
			actualContext: {},
			patch: { volumeBase: 50, boost: 2, speed: 1 },
		} as const;
		expect(isControlIntent(intent)).toBe(true);
		expect(isControlIntent({ ...intent, captureAdmission: 'extension-invocation' })).toBe(true);
		expect(isControlIntent({ ...intent, captureAdmission: 'page-gesture' })).toBe(false);
		const admittedEnvelope = {
			protocolVersion: 2,
			requestId: 'capture-admission-4',
			tabId: intent.tabId,
			documentId: intent.documentId,
			generation: intent.generation,
			type: 'spectra.control.intent.execute',
			payload: { ...intent, captureAdmission: 'extension-invocation' },
		} as const;
		expect(CONTENT_FACADE_RUNTIME_REVISION).toBe(SPECTRA_CONTENT_RUNTIME_REVISION);
		expect(isSpectraRequestEnvelope(admittedEnvelope)).toBe(true);
		expect(isContentSpectraRequestEnvelope(admittedEnvelope)).toBe(true);
		expect(isContentSpectraRequestEnvelope({
			...admittedEnvelope,
			payload: { ...intent, captureAdmission: 'page-gesture' },
		})).toBe(false);
		expect(isControlIntent({ ...intent, patch: {} })).toBe(false);
		expect(isControlIntent({ ...intent, patch: { volumeBase: 101 } })).toBe(false);
		expect(isControlIntent({ ...intent, generation: -1 })).toBe(false);
		expect(isControlIntent({ ...intent, requestedCoverage: 'opaque' })).toBe(false);
	});

	test('requires exact native strategy provenance for page observations and semantic reads', () => {
		const target = {
			frameId: 0,
			documentId: 'document-42',
			mediaId: 'media:3:1',
			sourceRevision: 2,
			kind: 'video',
		} as const;
		const pageObservation = {
			tabId: 42,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: { volumeBase: 80, mediaMuted: false },
			observedStrategies: { volumeBase: 'page-native', mediaMuted: 'dom-native' },
		} as const;
		expect(isControlSubmitRequest(pageObservation)).toBe(true);
		expect(isControlSubmitRequest({ ...pageObservation, observedStrategies: undefined })).toBe(false);
		expect(isControlSubmitRequest({
			...pageObservation,
			observedStrategies: { volumeBase: 'page-native' },
		})).toBe(false);
		expect(isControlSubmitRequest({
			...pageObservation,
			mutations: [{ field: 'volumeBase', operation: 'delta', value: 5 }],
		})).toBe(false);
		expect(isControlSubmitRequest({
			...pageObservation,
			source: 'popup',
		})).toBe(false);
		expect(isControlSubmitRequest({
			tabId: 42,
			source: 'popup',
			requestedCoverage: 'full',
			target: null,
			patch: { boost: 2 },
			captureAdmission: 'extension-invocation',
		})).toBe(false);
		expect(isControlSubmitRequest({
			...pageObservation,
			patch: { preservePitch: true },
			observedStrategies: { preservePitch: 'page-native' },
		})).toBe(false);

		const readResult = {
			target,
			patch: { volumeBase: 80, speed: 1.25, playing: true },
			observedStrategies: {
				volumeBase: 'page-native',
				speed: 'dom-native',
				playing: 'dom-native',
			},
		} as const;
		expect(isControlReadResult(readResult)).toBe(true);
		expect(isControlReadResult({
			...readResult,
			observedStrategies: { speed: 'dom-native', playing: 'dom-native' },
		})).toBe(false);
		expect(isControlReadResult({
			...readResult,
			observedStrategies: { ...readResult.observedStrategies, boost: 'page-native' },
		})).toBe(false);
	});

	test('validates actual per-field strategy and ownership without inferring it from 100% or 1x', () => {
		const snapshot = {
			tabId: 42,
			documentId: 'document-42',
			origin: 'https://media.example',
			generation: 3,
			revision: 10,
			activeMedia: null,
			activeVideo: null,
			fields: {
				volumeBase: field(100),
				speed: field(1),
				boost: {
					...field(1),
					strategy: 'media-webaudio',
					coverage: 'full',
				},
			},
		} as const;
		expect(isControlSnapshot(snapshot)).toBe(true);
		expect(isControlSnapshot({
			...snapshot,
			fields: { speed: { ...field(1), strategy: 'generic-main' } },
		})).toBe(false);
		expect(isControlSnapshot({
			...snapshot,
			fields: {
				volumeBase: {
					...field(100),
					strategy: 'capture',
					coverage: 'opaque',
				},
			},
		})).toBe(false);
		expect(isControlSnapshot({
			...snapshot,
			fields: {
				boost: {
					...field(2),
					actual: 1,
					phase: 'idle',
					strategy: 'observe',
					coverage: 'full',
					controlled: false,
				},
			},
		})).toBe(true);
		expect(isControlSnapshot({
			...snapshot,
			activeVideo: {
				frameId: 0,
				documentId: 'document-42',
				mediaId: 'media:audio',
				sourceRevision: 0,
				kind: 'audio',
			},
		})).toBe(false);
	});

	test('accepts page-native acknowledgements in the focused Content response guard', () => {
		const acknowledgement = {
			intentId: 'intent-page-native-mute',
			tabId: 42,
			documentId: 'document-42',
			generation: 3,
			revision: 11,
			target: null,
			fields: {
				mediaMuted: {
					desired: true,
					actual: true,
					revision: 11,
					phase: 'applied',
					strategy: 'page-native',
					coverage: 'active-target',
					controlled: false,
					lastError: null,
				},
			},
		};
		expect(isContentSpectraResponse(
			'spectra.control.intent.submit',
			{ ok: true, data: acknowledgement },
		)).toBe(true);
	});

	test('rejects operation success ACKs whose executor exceeds the declared algorithm policy', () => {
		const target = {
			frameId: 0,
			documentId: 'document-42',
			mediaId: 'media:video',
			sourceRevision: 1,
			kind: 'video',
		} as const;
		const acknowledgement = {
			operationId: 'operation:screenshot',
			tabId: 42,
			documentId: 'document-42',
			generation: 3,
			revision: 11,
			target,
			operation: 'screenshot',
			strategy: 'chrome-native',
			coverage: 'active-target',
			fields: {},
			result: {
				saved: true,
				method: 'capture-visible-tab',
				width: 1920,
				height: 1080,
			},
		} as const;
		expect(isControlOperationAck(acknowledgement)).toBe(true);
		expect(isControlOperationAck({
			...acknowledgement,
			strategy: 'extension-state',
		})).toBe(false);
	});

	test('covers every persistent field and momentary operation without classifying augmentation as native', () => {
		expect(CONTROL_FIELDS).toHaveLength(28);
		expect(CONTROL_OPERATIONS).toHaveLength(23);
		expect(CONTROL_DIRECT_FIELDS).toHaveLength(26);
		expect(CONTROL_CAPABILITIES).toHaveLength(51);
		expect(new Set(CONTROL_CAPABILITIES).size).toBe(
			CONTROL_FIELDS.length + CONTROL_OPERATIONS.length,
		);
		expect(classifyControlStrategy('page-native')).toBe('native');
		expect(classifyControlStrategy('dom-native')).toBe('native');
		expect(classifyControlStrategy('extension-css')).toBe('augmentation');
		expect(classifyControlStrategy('media-webaudio')).toBe('augmentation');
		expect(classifyControlStrategy('unsupported')).toBe('unsupported');
	});

	test('locks every strategy to one writer owner and forbids permission-boundary bypasses', () => {
		expect(Object.keys(CONTROL_STRATEGY_RULES).sort()).toEqual([...CONTROL_STRATEGIES].sort());
		for (const strategy of CONTROL_STRATEGIES) {
			const rule = CONTROL_STRATEGY_RULES[strategy];
			expect(rule.canBypassUserActivation).toBe(false);
			expect(rule.canBypassCorsOrDrm).toBe(false);
			if (rule.class === 'native' || rule.class === 'augmentation') {
				expect(rule.requiresActualReadback).toBe(true);
			}
			if (rule.interception === 'irreversible-media-source-binding') {
				expect(rule.admissionEvidence).toBe('proven-media-source-eligibility');
				expect(strategy).toBe('media-webaudio');
			}
			if (rule.mainWorld === 'exact-element-page-bridge') {
				expect(strategy).toBe('page-native');
			}
		}
		expect(CONTROL_STRATEGY_RULES['page-native']).toMatchObject({
			writerOwner: 'page-media-controller',
			admissionEvidence: 'page-controller-readback',
			mainWorld: 'exact-element-page-bridge',
			audioRuntimeCost: 'none',
		});
		expect(CONTROL_STRATEGY_RULES['dom-native'].audioRuntimeCost).toBe('none');
		expect(CONTROL_STRATEGY_RULES['media-webaudio'].audioRuntimeCost).toBe('lazy-audio-context');
		expect(CONTROL_STRATEGY_RULES.capture.audioRuntimeCost).toBe('lazy-offscreen-capture');
		expect(CONTROL_STRATEGY_RULES.capture.interception).toBe('authorized-tab-stream');
		expect(CONTROL_STRATEGY_RULES['extension-css'].interception).toBe(
			'reversible-extension-layer',
		);
	});

	test('falls through only for capability incompleteness and stops at browser boundaries', () => {
		for (const failure of CONTROL_RETRYABLE_STRATEGY_FAILURES) {
			expect(shouldTryNextControlStrategy(failure)).toBe(true);
		}
		for (const failure of CONTROL_TERMINAL_STRATEGY_FAILURES) {
			expect(shouldTryNextControlStrategy(failure)).toBe(false);
		}
	});

	test('classifies every algorithm exhaustively and keeps native candidates ahead of augmentation', () => {
		expect(Object.keys(CONTROL_ALGORITHM_POLICIES).sort()).toEqual(
			[...CONTROL_CAPABILITIES].sort(),
		);
		for (const capability of CONTROL_CAPABILITIES) {
			const policy = CONTROL_ALGORITHM_POLICIES[capability];
			expect(policy.orderedStrategies.length).toBeGreaterThan(0);
			expect(policy.orderedStrategies).not.toContain('unsupported');
			const nativeIndexes: number[] = [];
			const augmentationIndexes: number[] = [];
			for (const [index, strategy] of policy.orderedStrategies.entries()) {
				const classification = classifyControlStrategy(strategy);
				if (classification === 'native') nativeIndexes.push(index);
				if (classification === 'augmentation') augmentationIndexes.push(index);
			}
			if (nativeIndexes.length > 0 && augmentationIndexes.length > 0) {
				expect(Math.max(...nativeIndexes)).toBeLessThan(Math.min(...augmentationIndexes));
			}
		}
	});

	test('adjudicates native-only, hybrid, augmentation-only, and observation-only algorithms exhaustively', () => {
		expect(Object.keys(CONTROL_ALGORITHM_ADJUDICATIONS).sort()).toEqual(
			[...CONTROL_CAPABILITIES].sort(),
		);
		const totals = new Map<string, number>();
		for (const capability of CONTROL_CAPABILITIES) {
			const policy = CONTROL_ALGORITHM_POLICIES[capability];
			const adjudication = CONTROL_ALGORITHM_ADJUDICATIONS[capability];
			totals.set(
				adjudication.nativePreference,
				(totals.get(adjudication.nativePreference) ?? 0) + 1,
			);
			const classes = policy.orderedStrategies.map(classifyControlStrategy);
			const hasNative = classes.includes('native');
			const hasAugmentation = classes.includes('augmentation');
			const hasObservation = classes.includes('observe');

			switch (adjudication.nativePreference) {
				case 'observation-only':
					expect(hasObservation).toBe(true);
					expect(hasNative).toBe(false);
					break;
				case 'native-only':
					expect(hasNative).toBe(true);
					expect(hasAugmentation).toBe(false);
					expect(adjudication.augmentationAdmission).toBe('none');
					break;
				case 'hybrid-extension-native':
					expect(hasNative).toBe(true);
					expect(['state-then-native', 'compound']).toContain(policy.kind);
					expect(adjudication.augmentationAdmission).not.toBe('none');
					break;
				case 'augmentation-only':
					expect(hasNative).toBe(false);
					expect(hasAugmentation).toBe(true);
					expect(adjudication.augmentationAdmission).not.toBe('none');
					break;
			}
		}
		expect(Object.fromEntries(totals)).toEqual({
			'augmentation-only': 26,
			'hybrid-extension-native': 6,
			'native-only': 17,
			'observation-only': 2,
		});
	});

	test('keeps all 51 executable strategy orders, MAIN boundaries, ACKs, and lifetimes mirrored in the owner design', () => {
		const architecture = readFileSync(
			new URL('../docs/control/04a-algorithm-matrix.md', import.meta.url),
			'utf8',
		);
		for (const capability of CONTROL_CAPABILITIES) {
			const policy = CONTROL_ALGORITHM_POLICIES[capability];
			const adjudication = CONTROL_ALGORITHM_ADJUDICATIONS[capability];
			const mainWorld = policy.orderedStrategies.some(
				(strategy) => CONTROL_STRATEGY_RULES[strategy].mainWorld === 'exact-element-page-bridge',
			)
				? 'exact-element-page-bridge'
				: 'forbidden';
			const exactRow = [
				`| \`${capability}\``,
				`\`${adjudication.nativePreference}\``,
				`\`${adjudication.augmentationAdmission}\``,
				`\`${policy.orderedStrategies.join(' -> ')}\``,
				`\`${mainWorld}\``,
				`\`${policy.acknowledgements.join(' + ')}\``,
				`\`${policy.recurringWork}\` |`,
			].join(' | ');
			expect(architecture).toContain(exactRow);
		}
	});

	test('records recurring work only for explicitly owned or subscribed algorithms', () => {
		const recurring = Object.entries(CONTROL_ALGORITHM_POLICIES)
			.filter(([, policy]) => policy.recurringWork !== 'none')
			.map(([capability, policy]) => [capability, policy.recurringWork]);
		expect(recurring).toEqual([
			['boost', 'page-lifetime-after-media-binding'],
			['dimEnabled', 'while-owned'],
			['dimOpacity', 'while-owned'],
			['abLoop', 'while-owned'],
			['eqValues', 'page-lifetime-after-media-binding'],
			['bass', 'page-lifetime-after-media-binding'],
			['compressor', 'page-lifetime-after-media-binding'],
			['mono', 'page-lifetime-after-media-binding'],
			['pan', 'page-lifetime-after-media-binding'],
			['delay', 'page-lifetime-after-media-binding'],
			['visualizer', 'while-subscribed'],
		]);
	});

	test('keeps invasive strategies inside their audited capability families', () => {
		const capabilitiesFor = (strategy: keyof typeof CONTROL_STRATEGY_RULES) =>
			CONTROL_CAPABILITIES.filter((capability) =>
				CONTROL_ALGORITHM_POLICIES[capability].orderedStrategies.some(
					(candidate) => candidate === strategy,
				));

		expect(capabilitiesFor('media-webaudio')).toEqual([
			'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay', 'effective-volume',
		]);
		expect(capabilitiesFor('capture')).toEqual([
			'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay', 'effective-volume',
		]);
		expect(capabilitiesFor('extension-css')).toEqual([
			'rotation', 'mirrored', 'fill', 'filterEnabled', 'filter',
		]);
		expect(capabilitiesFor('extension-overlay')).toEqual(['dimEnabled', 'dimOpacity']);
		expect(capabilitiesFor('chrome-native')).toEqual([
			'tabMuted', 'tabPinned', 'screenshot', 'open-popup', 'open-options', 'open-url',
		]);

		for (const activationBound of ['playing', 'pip', 'fullscreen'] as const) {
			const strategies = CONTROL_ALGORITHM_POLICIES[activationBound].orderedStrategies;
			expect(strategies).not.toContain('media-webaudio');
			expect(strategies).not.toContain('capture');
		}
	});

	test('keeps A/B and visualizer on their operation/subscription entry points', () => {
		expect(isControlPatch({
			filterEnabled: true,
			dimEnabled: true,
			tabPinned: false,
		})).toBe(true);
		expect(isControlPatch({
			abLoop: { pointA: 2, pointB: 4, enabled: true },
		})).toBe(false);
		expect(isControlPatch({ visualizer: true })).toBe(false);
	});

	test('release-gates the narrow Content strategy projection against the canonical policy', () => {
		const pageNativeFields = new Set<ControlField>(CONTENT_PAGE_NATIVE_FIELDS);
		for (const field of CONTENT_DOM_NATIVE_FIELDS) {
			expect(CONTROL_ALGORITHM_POLICIES[field].orderedStrategies).toEqual(
				pageNativeFields.has(field)
					? ['page-native', 'dom-native']
					: ['dom-native'],
			);
			expect(contentControlStrategy(field, 'active-target')).toBe('dom-native');
			expect(contentControlStrategy(field, 'full')).toBeNull();
		}
		for (const field of CONTENT_EXTENSION_CSS_FIELDS) {
			expect(CONTROL_ALGORITHM_POLICIES[field].orderedStrategies).toEqual(['extension-css']);
			expect(contentControlStrategy(field, 'active-target')).toBe('extension-css');
		}
		for (const field of CONTENT_EXTENSION_OVERLAY_FIELDS) {
			expect(CONTROL_ALGORITHM_POLICIES[field].orderedStrategies).toEqual(['extension-overlay']);
			expect(contentControlStrategy(field, 'active-target')).toBe('extension-overlay');
		}
		for (const operation of CONTROL_OPERATIONS) {
			expect(isContentActiveVideoOperation(operation)).toBe(
				CONTENT_ACTIVE_VIDEO_OPERATIONS.includes(operation as never),
			);
			if (isContentActiveVideoOperation(operation)) {
				expect(CONTROL_ALGORITHM_POLICIES[operation].scope).toBe('active-video');
			}
		}
	});

	test('keeps the Content runtime facade aligned with the formal settings wire values', () => {
		const event = {
			protocolVersion: 2,
			type: 'spectra.content.settings.changed',
			payload: {
				osdEnabled: true,
				visualizerEnabled: true,
				lang: 'zh-CN',
				themeMode: 'system',
				pauseRetentionSeconds: 60,
				osdMessages: {
					muted: '静音',
					corsAutoAdded: '自动',
					corsAddedSafe: '安全',
					corsCorrectedSafe: '已更正',
				},
			},
		};
		expect(isContentSpectraEventEnvelope(event)).toBe(true);
		expect(isContentSpectraEventEnvelope({
			...event,
			payload: { ...event.payload, themeMode: 'auto' },
		})).toBe(false);
	});
});
