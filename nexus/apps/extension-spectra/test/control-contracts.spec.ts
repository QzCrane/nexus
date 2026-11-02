import { describe, expect, test } from 'bun:test';
import {
	compileEffectiveVolume,
	CONTROL_VALUE_LIMITS,
	CONTROL_ALGORITHM_ADJUDICATIONS,
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_CAPABILITIES,
	CONTROL_DIRECT_FIELDS,
	CONTROL_FIELDS,
	CONTROL_SESSION_FIELDS,
	CONTROL_OPERATIONS,
	CONTROL_RETRYABLE_STRATEGY_FAILURES,
	CONTROL_STRATEGIES,
	CONTROL_STRATEGY_RULES,
	CONTROL_TERMINAL_STRATEGY_FAILURES,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	classifyControlStrategy,
	isControlIntent,
	isCaptureAdmission,
	explainControlApplyAck,
	isControlApplyAck,
	isControlOperationAck,
	isControlPatch,
	isControlReadResult,
	isControlSnapshot,
	isControlSubmitRequest,
	isSpectraRequestEnvelope,
	resolveAcknowledgedProcessorLifecycle,
	resolveControlAudioVolume,
	shouldTryNextControlStrategy,
	splitEffectiveVolume,
	type ControlField,
	type ControlFieldStates,
	type ControlFieldState,
} from '@nexus/contracts';
import { createCaptureAdmission } from './helpers/capture-admission';
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
	});

	test('owns numeric ranges and strict one-shot Capture grant shape in contracts', () => {
		expect(CONTROL_VALUE_LIMITS.speed).toEqual({ min: 0.1, max: 16 });
		expect(isControlPatch({ speed: CONTROL_VALUE_LIMITS.speed.min })).toBe(true);
		expect(isControlPatch({ speed: CONTROL_VALUE_LIMITS.speed.max })).toBe(true);
		expect(isControlPatch({ speed: CONTROL_VALUE_LIMITS.speed.min - 0.01 })).toBe(false);
		expect(isControlPatch({ speed: CONTROL_VALUE_LIMITS.speed.max + 0.01 })).toBe(false);
		const admission = createCaptureAdmission();
		expect(isCaptureAdmission(admission)).toBe(true);
		expect(isCaptureAdmission({ ...admission, oneShot: false })).toBe(false);
		expect(isCaptureAdmission({ ...admission, issuer: 'capture-session-authority' })).toBe(false);
		expect(isCaptureAdmission({ ...admission, surplus: true })).toBe(false);
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
		const admission = createCaptureAdmission();
		expect(isControlIntent(intent)).toBe(true);
		expect(isControlIntent({ ...intent, captureAdmission: admission })).toBe(true);
		expect(isControlIntent({ ...intent, processorHold: true })).toBe(true);
		expect(isControlIntent({ ...intent, captureAdmission: 'extension-invocation' })).toBe(false);
		expect(isControlIntent({ ...intent, captureAdmission: 'page-gesture' })).toBe(false);
		const admittedEnvelope = {
			protocolVersion: 2,
			requestId: 'capture-admission-4',
			tabId: intent.tabId,
			documentId: intent.documentId,
			generation: intent.generation,
			type: 'spectra.control.intent.execute',
			payload: { ...intent, captureAdmission: admission },
		} as const;
		expect(CONTENT_FACADE_RUNTIME_REVISION).toBe(SPECTRA_CONTENT_RUNTIME_REVISION);
		expect(isSpectraRequestEnvelope(admittedEnvelope)).toBe(true);
		expect(isContentSpectraRequestEnvelope(admittedEnvelope)).toBe(true);
		expect(isContentSpectraRequestEnvelope({
			...admittedEnvelope,
			payload: { ...intent, captureAdmission: 'page-gesture' },
		})).toBe(false);
		expect(isControlIntent({ ...intent, patch: {} })).toBe(false);
		expect(isControlIntent({ ...intent, patch: { volumeBase: 101 } })).toBe(true);
		expect(isControlIntent({ ...intent, patch: { volumeBase: 801 } })).toBe(false);
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
		const bootstrapVolumeObservation = {
			...pageObservation,
			target: null,
			patch: { volumeBase: 64, mediaMuted: true },
			observedStrategies: { volumeBase: 'dom-native', mediaMuted: 'page-native' },
		} as const;
		expect(isControlSubmitRequest(bootstrapVolumeObservation)).toBe(true);
		expect(isControlSubmitRequest({
			...bootstrapVolumeObservation,
			patch: { volumeBase: 64 },
			observedStrategies: { volumeBase: 'dom-native' },
		})).toBe(false);
		expect(isControlSubmitRequest({
			...bootstrapVolumeObservation,
			patch: { speed: 1.5, preservePitch: false },
			observedStrategies: { speed: 'page-native', preservePitch: 'dom-native' },
		})).toBe(true);
		expect(isControlSubmitRequest({
			...bootstrapVolumeObservation,
			patch: { playing: true },
			observedStrategies: { playing: 'dom-native' },
		})).toBe(false);
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

		// Video effect fields are written by the extension's own CSS and overlay
		// layers. Those writers must be able to report the value they produced;
		// reporting them as DOM-native - or reporting nothing at all - is a lie
		// the contract now rejects on both ends.
		expect(isControlReadResult({
			target,
			patch: { rotation: 90, dimEnabled: true },
			observedStrategies: { rotation: 'extension-css', dimEnabled: 'extension-overlay' },
		})).toBe(true);
		expect(isControlReadResult({
			target,
			patch: { rotation: 90, dimEnabled: true },
			observedStrategies: { rotation: 'dom-native', dimEnabled: 'extension-overlay' },
		})).toBe(false);
		expect(isControlReadResult({
			target,
			patch: { rotation: 90 },
			observedStrategies: {},
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
					strategy: 'capture',
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
		expect(classifyControlStrategy('capture-observe')).toBe('observe');
		expect(classifyControlStrategy('extension-css')).toBe('augmentation');
		expect(classifyControlStrategy('capture')).toBe('augmentation');
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
			if (rule.interception === 'authorized-tab-stream') {
				expect(rule.admissionEvidence).toBe('authorized-capture-readback');
				expect(['capture', 'capture-observe']).toContain(strategy);
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
		expect(CONTROL_STRATEGY_RULES.capture.audioRuntimeCost).toBe('lazy-offscreen-capture');
		expect(CONTROL_STRATEGY_RULES.capture.interception).toBe('authorized-tab-stream');
		expect(CONTROL_STRATEGY_RULES['capture-observe']).toMatchObject({
			class: 'observe',
			writerOwner: 'capture-processor',
			interception: 'authorized-tab-stream',
			audioRuntimeCost: 'lazy-offscreen-capture',
		});
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
		expect(CONTROL_ALGORITHM_POLICIES.playing.acknowledgements).toEqual(['dom-stable-getter']);
		expect(CONTROL_ALGORITHM_POLICIES['playback-toggle'].acknowledgements).toEqual(['dom-stable-getter']);
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

	test('classifies exactly the durable fields that may cross a document refresh', () => {
		expect(CONTROL_SESSION_FIELDS).toEqual([
			'audioEnabled', 'volumeBase', 'boost', 'mediaMuted', 'speed', 'preservePitch', 'loop',
			'rotation', 'mirrored', 'fill', 'filterEnabled', 'filter', 'dimEnabled', 'dimOpacity',
			'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay',
		]);
		for (const transient of [
			'tabMuted', 'tabPinned', 'playing', 'currentTime', 'pip', 'fullscreen', 'abLoop', 'visualizer',
		]) {
			expect(CONTROL_SESSION_FIELDS).not.toContain(transient as never);
		}
	});

	test('records recurring work only for explicitly owned or subscribed algorithms', () => {
		const recurring = Object.entries(CONTROL_ALGORITHM_POLICIES)
			.filter(([, policy]) => policy.recurringWork !== 'none')
			.map(([capability, policy]) => [capability, policy.recurringWork]);
		expect(recurring).toEqual([
			['boost', 'while-owned'],
			['dimEnabled', 'while-owned'],
			['dimOpacity', 'while-owned'],
			['abLoop', 'while-owned'],
			['eqValues', 'while-owned'],
			['bass', 'while-owned'],
			['compressor', 'while-owned'],
			['mono', 'while-owned'],
			['pan', 'while-owned'],
			['delay', 'while-owned'],
			['visualizer', 'while-subscribed'],
		]);
	});

	test('keeps invasive strategies inside their audited capability families', () => {
		const capabilitiesFor = (strategy: keyof typeof CONTROL_STRATEGY_RULES) =>
			CONTROL_CAPABILITIES.filter((capability) =>
				CONTROL_ALGORITHM_POLICIES[capability].orderedStrategies.some(
					(candidate) => candidate === strategy,
				));

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
		expect(CONTROL_ALGORITHM_POLICIES.visualizer.orderedStrategies).toEqual([
			'media-webaudio',
			'capture-observe',
		]);
		expect(CONTROL_ALGORITHM_ADJUDICATIONS.visualizer).toEqual({
			nativePreference: 'observation-only',
			augmentationAdmission: 'explicit-foreground-subscription',
		});
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
		const feedback = {
			protocolVersion: 2,
			type: 'spectra.hotkey.target.feedback',
			tabId: 42,
			payload: {
				action: 'volume_up',
				targetTabId: 7,
				targetTitle: 'Media',
				targetHostname: 'media.example',
				gesture: 'default:7',
				feedback: { kind: 'volume', value: 110, volumeState: 'capture' },
			},
		};
		expect(isContentSpectraEventEnvelope(feedback)).toBe(true);
		expect(isContentSpectraEventEnvelope({
			...feedback,
			payload: { ...feedback.payload, gesture: '' },
		})).toBe(false);
	});

	test('projects one immutable Popup-compatible volume pair from the latest acknowledged revision', () => {
		const captureFields: ControlFieldStates = {
			volumeBase: field(100),
			boost: {
				...field(1.1),
				strategy: 'capture',
				coverage: 'opaque',
			},
			mediaMuted: field(false),
		};
		expect(resolveAcknowledgedProcessorLifecycle(captureFields)).toEqual({
			actualMode: 'capture',
			phase: 'active',
		});
		const captured = resolveControlAudioVolume(captureFields);
		expect(captured).toEqual({ effectiveVolume: 110, volumeState: 'capture' });

		const pageWebAudioFields: ControlFieldStates = {
			...captureFields,
			boost: {
				...field(1.1),
				strategy: 'media-webaudio',
				coverage: 'full',
			},
		};
		expect(resolveAcknowledgedProcessorLifecycle(pageWebAudioFields)).toEqual({
			actualMode: 'webaudio',
			phase: 'active',
		});
		expect(resolveControlAudioVolume(pageWebAudioFields)).toEqual({
			effectiveVolume: 110,
			volumeState: 'native',
		});

		const newerRelease: ControlFieldStates = {
			...captureFields,
			compressor: {
				...field(false),
				revision: 5,
				phase: 'idle',
				strategy: 'observe',
				controlled: false,
			},
		};
		expect(resolveAcknowledgedProcessorLifecycle(newerRelease)).toEqual({
			actualMode: 'bypass',
			phase: 'idle',
		});
		expect(resolveControlAudioVolume(newerRelease)).toEqual({
			effectiveVolume: 110,
			volumeState: 'native',
		});

		captureFields.boost = {
			...field(1),
			phase: 'idle',
			strategy: 'observe',
			coverage: 'full',
			controlled: false,
		};
		expect(captured).toEqual({ effectiveVolume: 110, volumeState: 'capture' });
		expect(resolveControlAudioVolume(captureFields)).toEqual({
			effectiveVolume: 100,
			volumeState: 'native',
		});
		expect(resolveControlAudioVolume({
			...captureFields,
			mediaMuted: field(true),
		})).toEqual({ effectiveVolume: 100, volumeState: 'silent' });
		expect(resolveControlAudioVolume({
			volumeBase: field(100),
			boost: field(1),
		})).toBeNull();
	});
	test('accepts an ack that populates every optional field', () => {
		// The runtime allowlist and the type have to move together. A field that a
		// producer sets while the allowlist omits it invalidates the whole ack, and
		// the only visible symptom is a popup that falls back to its previous
		// value. `writeState` shipped exactly that way.
		const ack = {
			intentId: 'intent:maximal',
			tabId: 7,
			documentId: 'document:maximal',
			generation: 1,
			revision: 3,
			target: {
				frameId: 0,
				documentId: 'document:maximal',
				mediaId: 'media:maximal',
				sourceRevision: 1,
				kind: 'audio' as const,
			},
			fields: {
				volumeBase: {
					desired: 40,
					actual: 40,
					restoreBaseline: 100,
					revision: 3,
					phase: 'applied' as const,
					writeState: 'written' as const,
					strategy: 'dom-native' as const,
					coverage: 'active-target' as const,
					controlled: true,
					intentId: 'intent:maximal',
					lastError: null,
				},
			},
			audioVolume: { effectiveVolume: 40, volumeState: 'native' as const },
		};

		expect(isControlApplyAck(ack)).toBe(true);
		// An allowlist that admits everything proves nothing: an unknown key still
		// has to fail.
		expect(isControlApplyAck({ ...ack, writeState: 'written' })).toBe(false);
	});

	test('names the offending key instead of only rejecting', () => {
		// A boolean rejection forces the boundary to log a blob. Naming the key is
		// what turns a production symptom into a one-line diagnosis, which is how
		// the missing `writeState` entry should have surfaced the first time.
		const ack = {
			intentId: 'intent:explain',
			tabId: 7,
			documentId: 'document:explain',
			generation: 1,
			revision: 2,
			target: null,
			fields: {
				volumeBase: {
					desired: 40,
					actual: 40,
					revision: 2,
					phase: 'applied' as const,
					strategy: 'dom-native' as const,
					coverage: 'active-target' as const,
					controlled: true,
					lastError: null,
					writeStateTypo: 'written',
				},
			},
		};

		expect(isControlApplyAck(ack)).toBe(false);
		expect(explainControlApplyAck(ack)).toBe(
			'fields.volumeBase has unexpected keys: writeStateTypo',
		);
		expect(explainControlApplyAck({ ...ack, fields: {} })).toBeNull();
	});
});
