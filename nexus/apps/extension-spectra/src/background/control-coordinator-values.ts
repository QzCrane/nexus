import {
	CONTROL_BOOTSTRAP_OBSERVATION_GROUPS,
	CONTROL_SESSION_FIELDS,
	MEDIA_OBSERVATION_FIELDS,
	clampControlValue,
	compareMediaObservations,
	selectControlCapabilityScope,
	type CaptureAdmission,
	type ControlActualContext,
	type ControlCapability,
	type ControlDirectField,
	type ControlField,
	type ControlFieldStates,
	type ControlIntent,
	type ControlMutation,
	type ControlObservationStrategies,
	type ControlOperationIntent,
	type ControlOperationRequest,
	type ControlPatch,
	type ControlReadResult,
	type ControlSessionPatch,
	type ControlSnapshot,
	type ControlSubmitRequest,
	type ControlValues,
	type MediaTarget,
	type MediaObservationStamp,
} from '@nexus/contracts';

export const PAGE_OBSERVABLE_FIELDS = new Set<ControlField>([
	'volumeBase',
	'mediaMuted',
	'speed',
	'preservePitch',
	'playing',
	'currentTime',
	'loop',
	'pip',
	'fullscreen',
]);

export const ORDERED_MEDIA_FIELDS = new Set<ControlField>(MEDIA_OBSERVATION_FIELDS);

export const BOOTSTRAP_PAGE_OBSERVABLE_FIELDS = new Set<ControlField>(
	CONTROL_BOOTSTRAP_OBSERVATION_GROUPS.flat(),
);

export const AUDIO_PROJECTION_FIELDS = new Set<ControlField>([
	'audioEnabled',
	'volumeBase',
	'boost',
	'mediaMuted',
	'speed',
	'preservePitch',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
]);

export interface ControlTargetProjection {
	activeMedia: ControlSnapshot['activeMedia'];
	activeVideo: ControlSnapshot['activeVideo'];
}

export function controlTargetScopeFlags(capabilities: readonly ControlCapability[]): {
	updatesMedia: boolean;
	updatesVideo: boolean;
} {
	const scopes = capabilities.map(selectControlCapabilityScope);
	return {
		updatesMedia: scopes.some((scope) => scope === 'active-media'
			|| scope === 'media-source'
			|| scope === 'requested-audio-scope'),
		updatesVideo: scopes.some((scope) => scope === 'active-video'),
	};
}

export type ControlTargetScopeRequest = Pick<ControlSubmitRequest, 'patch' | 'mutations' | 'target'>;

export function assertUnambiguousTargetScope(request: ControlTargetScopeRequest): void {
	const capabilities = [
		...Object.keys(request.patch ?? {}),
		...(request.mutations ?? []).map(({ field }) => field),
	] as ControlCapability[];
	const { updatesMedia, updatesVideo } = controlTargetScopeFlags(capabilities);
	if (updatesVideo && request.target?.kind === 'audio') {
		throw new Error('A video-scoped control cannot target an audio element');
	}
	if (updatesMedia && updatesVideo && request.target === null) {
		throw new Error('Mixed media/video controls require one explicit video target');
	}
}

// An ACK target identifies what executed; it is not permission to replace both
// active identities. Contract scope is the executable owner of that projection:
// video-only controls update only activeVideo, tab/document controls update
// neither, and media/audio/source controls update activeMedia (plus activeVideo
// when the resolved media itself is a video).
export function projectControlTarget(
	baseline: Pick<ControlSnapshot, 'activeMedia' | 'activeVideo'>,
	capabilities: readonly ControlCapability[],
	target: MediaTarget | null,
): ControlTargetProjection {
	let activeMedia = baseline.activeMedia;
	let activeVideo = baseline.activeVideo;
	if (!target) return { activeMedia, activeVideo };

	const { updatesMedia, updatesVideo } = controlTargetScopeFlags(capabilities);
	if (updatesMedia) {
		activeMedia = target;
		if (target.kind === 'video') activeVideo = target;
	}
	if (updatesVideo && target.kind === 'video') activeVideo = target;
	return { activeMedia, activeVideo };
}

export function sameMediaTarget(
	left: MediaTarget | null,
	right: MediaTarget | null,
): boolean {
	return left === right || Boolean(left && right
		&& left.documentId === right.documentId
		&& left.frameId === right.frameId
		&& left.mediaId === right.mediaId
		&& left.sourceRevision === right.sourceRevision
		&& left.kind === right.kind);
}

export function sameMediaObservationSelection(left: MediaObservationStamp, right: MediaObservationStamp): boolean {
	return left.epoch === right.epoch && left.owner === right.owner && left.selection === right.selection;
}

/** Retire source actuals without manufacturing a replacement's desired values. */
export function retireMediaActualFields(
	fields: ControlFieldStates,
	media: boolean,
	video: boolean,
	revision: number,
): ControlFieldStates {
	const retired: ControlFieldStates = {};
	for (const [rawField, state] of Object.entries(fields)) {
		if (!state) continue;
		const field = rawField as ControlField;
		const scope = selectControlCapabilityScope(field);
		if ((field === 'volumeBase' || field === 'mediaMuted')
			&& state.strategy === 'capture' && state.coverage === 'opaque') continue;
		// Full-output DSP belongs to the document's acknowledged processor, not
		// the selected media registry. A selection/registry replacement must not
		// erase an active Capture gain or its neutral readback; its own lifecycle
		// reports retirement. Target-scoped audio facts still retire normally.
		if (!(media && (scope === 'active-media' || scope === 'media-source'
			|| scope === 'requested-audio-scope' && state.coverage !== 'full' && state.coverage !== 'opaque')
			|| video && scope === 'active-video')) continue;
		Object.assign(retired, { [field]: { ...state, desired: null, actual: null, revision,
			phase: 'idle', controlled: false, lastError: null } });
	}
	return retired;
}

/** Field samples are ordered independently of control intent revisions. */
export function mergeMediaObservedFields(
	current: ControlFieldStates,
	incoming: ControlFieldStates,
	stamp: MediaObservationStamp | undefined,
	observation: boolean,
): ControlFieldStates {
	const fields: ControlFieldStates = { ...current };
	for (const [rawField, state] of Object.entries(incoming)) {
		if (!state) continue;
		const field = rawField as ControlField;
		const previous = current[field];
		if (observation && (field === 'volumeBase' || field === 'mediaMuted')
			&& previous?.strategy === 'capture' && previous.controlled
			&& state.strategy !== 'capture') continue;
		const sample = ORDERED_MEDIA_FIELDS.has(field) ? state.mediaObservation ?? stamp : undefined;
		if (previous?.mediaObservation && ORDERED_MEDIA_FIELDS.has(field)) {
			if (!sample && !observation && state.desired === null && !state.controlled && state.lastError === null) {
				// A release ACK may relinquish writer ownership without supplying a
				// new physical sample. Preserve the actual value and its proof.
				Object.assign(fields, { [field]: { ...previous, desired: null, controlled: false,
					revision: state.revision, intentId: state.intentId } });
				continue;
			}
			const order = sample ? compareMediaObservations(sample, previous.mediaObservation) : -1;
			if (order === null || order < 0) continue;
		}
		// Reading the same physical value is not a new page gesture that releases
		// an acknowledged writer. The newer sample still advances its evidence.
		const value = observation && previous?.phase === 'applied' && previous.actual === state.actual
			? { ...previous, ...(sample ? { mediaObservation: sample } : {}) }
			: { ...state, ...(sample ? { mediaObservation: sample } : {}) };
		Object.assign(fields, { [field]: value });
	}
	return fields;
}

// An observation is a value and the writer that produced it. The two travel
// together so no caller can synthesise an "actual" value and guess its
// provenance: `applyPageObservation` already refuses that, and native
// observations obey the same rule. A field whose strategy is missing is a
// programming error, not a value that can be attributed to DOM.
export function nativeObservationFields(
	observation: Pick<ControlReadResult, 'patch' | 'observedStrategies'>,
	revision: number,
): ControlFieldStates {
	const fields: ControlFieldStates = {};
	for (const [rawField, actual] of Object.entries(observation.patch)) {
		const field = rawField as ControlDirectField;
		const strategy = observation.observedStrategies[field];
		if (!strategy) {
			throw new Error(`Native observation is missing strategy provenance for ${field}`);
		}
		(fields as Record<string, unknown>)[field] = {
			desired: actual,
			actual,
			revision,
			phase: 'applied',
			strategy,
			coverage: strategy === 'capture' ? 'opaque' : 'active-target',
			controlled: false,
			lastError: null,
		};
	}
	return fields;
}

export function neutralBoostObservation(
	revision: number,
	intentId: string,
): NonNullable<ControlFieldStates['boost']> {
	return {
		desired: 1,
		actual: 1,
		revision,
		phase: 'idle',
		strategy: 'observe',
		coverage: 'full',
		controlled: false,
		intentId,
		lastError: null,
	};
}

export interface ResolvedControlIntentRequest {
	releaseDocumentOutput?: true;
	tabId: number;
	source: ControlIntent['source'];
	requestedCoverage: ControlIntent['requestedCoverage'];
	target: MediaTarget | null;
	patch: ControlPatch;
	mediaRestore?: ControlIntent['mediaRestore'];
	captureAdmission?: CaptureAdmission;
}

export function createIntent(
	snapshot: ControlSnapshot,
	request: ResolvedControlIntentRequest,
	intentId: string,
): ControlIntent {
	const actualContext: ControlActualContext = {};
	for (const field of ['volumeBase', 'mediaMuted', 'speed', 'preservePitch'] as const) {
		const state = snapshot.fields[field];
		if (state?.phase === 'applied' && state.actual !== null) {
			(actualContext as Record<string, unknown>)[field] = state.actual;
		}
		if (request.source === 'page' && request.patch[field] !== undefined) {
			(actualContext as Record<string, unknown>)[field] = request.patch[field];
		}
	}
	return {
		intentId,
		tabId: request.tabId,
		documentId: snapshot.documentId,
		generation: snapshot.generation,
		baseRevision: snapshot.revision,
		source: request.source,
		requestedCoverage: request.requestedCoverage,
		// `null` is an explicit live-active selection. Content resolves it from
		// the current document registry; Background must not silently replace it
		// with a possibly stale snapshot target.
		target: request.target,
		actualContext,
		patch: request.patch,
		...(request.releaseDocumentOutput ? { releaseDocumentOutput: true as const } : {}),
		...(request.mediaRestore ? { mediaRestore: request.mediaRestore } : {}),
		...(request.captureAdmission
			? { captureAdmission: request.captureAdmission }
			: {}),
	};
}

export function defaultControlValue(field: ControlField): ControlValues[ControlField] {
	switch (field) {
		case 'volumeBase': return 100;
		case 'boost': return 1;
		case 'speed': return 1;
		case 'currentTime': return 0;
		case 'rotation': return 0;
		case 'dimOpacity': return 0.72;
		case 'pan': return 0;
		case 'delay': return 0;
		case 'eqValues': return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		case 'filter': return {
			brightness: 100,
			contrast: 100,
			saturate: 100,
			grayscale: false,
			invert: false,
		};
		case 'abLoop': return { pointA: null, pointB: null, enabled: false };
		default: return false;
	}
}

export function normalizeMutationValue(
	field: ControlField,
	value: ControlValues[ControlField],
): ControlValues[ControlField] {
	if (typeof value !== 'number') return value;
	switch (field) {
		case 'volumeBase': return clampControlValue(value, 'nativeVolume', 100);
		case 'boost': return Math.round(clampControlValue(value, 'boost', 1) * 10) / 10;
		case 'speed': return Math.round(clampControlValue(value, 'speed', 1) * 100) / 100;
		case 'currentTime': return clampControlValue(value, 'currentTime', 0);
		case 'rotation': return ((Math.round(value / 90) * 90 % 360) + 360) % 360 as 0 | 90 | 180 | 270;
		case 'dimOpacity': return clampControlValue(value, 'dimOpacity', 0);
		case 'pan': return Math.round(clampControlValue(value, 'pan', 0) * 100) / 100;
		case 'delay': return Math.round(clampControlValue(value, 'delay', 0));
		default: return value;
	}
}

export function applyMutation(
	current: ControlValues[ControlField],
	mutation: ControlMutation,
): ControlValues[ControlField] {
	if (mutation.operation === 'set') {
		return normalizeMutationValue(mutation.field, mutation.value as ControlValues[ControlField]);
	}
	if (mutation.operation === 'toggle') return !current;
	return normalizeMutationValue(
		mutation.field,
		(Number(current) + Number(mutation.value)) as ControlValues[ControlField],
	);
}

export function assignFieldState<K extends ControlField>(
	fields: ControlFieldStates,
	field: K,
	desired: ControlValues[K],
	actual: ControlValues[K],
	revision: number,
	intentId: string,
): void {
	const matches = JSON.stringify(desired) === JSON.stringify(actual);
	(fields as Record<string, unknown>)[field] = {
		desired,
		actual,
		revision,
		phase: matches ? 'applied' : 'error',
		strategy: 'chrome-native',
		coverage: 'full',
		controlled: matches,
		intentId,
		lastError: matches
			? null
			: {
				code: 'readback-mismatch',
				message: 'Chrome state differs from the requested value',
				retryable: true,
			},
	};
}

export function applyPageObservation(
	intent: ControlIntent,
	observedStrategies: ControlObservationStrategies | undefined,
): ControlFieldStates {
	if (intent.requestedCoverage !== 'active-target') {
		throw new Error('A page observation cannot claim full-output coverage');
	}
	if (!observedStrategies) throw new Error('A page observation requires native strategy provenance');
	const patchKeys = Object.keys(intent.patch);
	if (!intent.target
		&& patchKeys.some((field) => !BOOTSTRAP_PAGE_OBSERVABLE_FIELDS.has(field as ControlField))) {
		throw new Error('A targetless bootstrap observation contains a target-bound field');
	}
	const strategyKeys = Object.keys(observedStrategies);
	if (patchKeys.length !== strategyKeys.length
		|| patchKeys.some((field) => !Object.hasOwn(observedStrategies, field))) {
		throw new Error('Page observation strategy provenance must match every patch field');
	}
	const fields: ControlFieldStates = {};
	const revision = intent.baseRevision + 1;
	for (const [rawField, rawValue] of Object.entries(intent.patch)) {
		const field = rawField as ControlDirectField;
		if (!PAGE_OBSERVABLE_FIELDS.has(field)) {
			throw new Error(`Page observation is not admitted for ${field}`);
		}
		(fields as Record<string, unknown>)[field] = {
			desired: rawValue,
			actual: rawValue,
			revision,
			phase: 'applied',
			strategy: observedStrategies[field],
			coverage: 'active-target',
			controlled: false,
			intentId: intent.intentId,
			lastError: null,
		};
	}
	return fields;
}

export function projectControlSessionPatch(fields: ControlFieldStates): ControlSessionPatch {
	const patch: ControlSessionPatch = {};
	for (const field of CONTROL_SESSION_FIELDS) {
		const state = fields[field];
		if (state?.phase !== 'applied' || state.actual === null) continue;
		(patch as Record<string, unknown>)[field] = structuredClone(state.actual);
	}
	return patch;
}

export type ControlSessionProjectionScope = 'origin' | 'resource' | 'none';

export function controlSessionScopeForSource(
	source: ControlIntent['source'],
): ControlSessionProjectionScope {
	if (source === 'restore') return 'none';
	if (source === 'page' || source === 'system') return 'resource';
	return 'origin';
}

export const RESET_AUDIO_TARGET_PATCH: ControlPatch = {
	volumeBase: 100,
	mediaMuted: false,
	speed: 1,
};

export const RESET_AUDIO_PROCESSOR_PATCH: ControlPatch = {
	// rule: reset clears DSP parameters but keeps the audio enhancement enabled.
	// Closing the master switch on reset discarded the user's enhancement preference
	// and left the page silent until they re-toggled it.
	audioEnabled: true,
	boost: 1,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	bass: false,
	compressor: false,
	mono: false,
	pan: 0,
	delay: 0,
};

export const RESET_VIDEO_PATCH: ControlPatch = {
	rotation: 0,
	mirrored: false,
	fill: false,
	filterEnabled: false,
	filter: {
		brightness: 100,
		contrast: 100,
		saturate: 100,
		grayscale: false,
		invert: false,
	},
	dimEnabled: false,
	dimOpacity: 0.72,
};

export const RESTORABLE_TARGET_FIELDS = [
	'volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'loop',
	'rotation', 'mirrored', 'fill', 'filterEnabled', 'filter', 'dimEnabled', 'dimOpacity',
] as const satisfies readonly ControlDirectField[];

export const RESTORABLE_PROCESSOR_FIELDS = [
	'audioEnabled', 'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay',
] as const satisfies readonly ControlDirectField[];

export function snapshotActualPatch(
	snapshot: ControlSnapshot,
	fields: readonly ControlDirectField[],
	controlledOnly: boolean,
): ControlPatch {
	const patch: ControlPatch = {};
	for (const field of fields) {
		const state = snapshot.fields[field];
		if (!state || state.actual === null || controlledOnly && !state.controlled) continue;
		(patch as Record<string, unknown>)[field] = structuredClone(state.actual);
	}
	return patch;
}

export function operationIntent(
	snapshot: ControlSnapshot,
	request: ControlOperationRequest & { tabId: number },
	operationId: string,
): ControlOperationIntent {
	return {
		operationId,
		tabId: request.tabId,
		documentId: snapshot.documentId,
		generation: snapshot.generation,
		baseRevision: snapshot.revision,
		source: request.source,
		// Preserve the same nullable live-active semantic used by field intents.
		target: request.target,
		operation: request.operation,
		payload: request.payload,
	} as ControlOperationIntent;
}

export function stageSnapshot(
	baseline: ControlSnapshot,
	fields: ControlFieldStates,
	activeMedia: ControlSnapshot['activeMedia'],
): ControlSnapshot {
	return {
		...baseline,
		activeMedia: activeMedia ?? baseline.activeMedia,
		activeVideo: activeMedia?.kind === 'video' ? activeMedia : baseline.activeVideo,
		fields: { ...baseline.fields, ...fields },
	};
}

export function assertAppliedPatch(
	fields: ControlFieldStates,
	patch: ControlPatch,
	label: string,
): void {
	assertAppliedFields(fields, Object.keys(patch) as ControlField[], label);
}

export function assertReleasedPatch(
	fields: ControlFieldStates,
	patch: ControlPatch,
	label: string,
): void {
	for (const field of Object.keys(patch) as ControlField[]) {
		const state = fields[field];
		if (state?.phase === 'applied'
			|| (state?.phase === 'idle'
				&& JSON.stringify(state.actual) === JSON.stringify(patch[field as keyof ControlPatch]))) {
			continue;
		}
		const detail = state?.lastError
			? `${state.lastError.code}: ${state.lastError.message}`
			: 'missing released field acknowledgement';
		throw new Error(`${label} failed for ${field}: ${detail}`);
	}
}

export function assertAppliedFields(
	fields: ControlFieldStates,
	requiredFields: readonly ControlField[],
	label: string,
): void {
	for (const field of requiredFields) {
		const state = fields[field];
		if (state?.phase === 'applied') continue;
		// A capability gap already carries the sentence the user has to act on
		// ("this needs the tab in the foreground"). Prefixing it with the internal
		// stage name and the failure code only buries that sentence.
		if (state?.lastError?.code === 'capability-unavailable') throw new Error(state.lastError.message);
		const detail = state?.lastError
			? `${state.lastError.code}: ${state.lastError.message}`
			: 'missing actual field acknowledgement';
		throw new Error(`${label} failed for ${field}: ${detail}`);
	}
}
