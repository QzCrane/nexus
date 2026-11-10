// goal: translate content hotkeys into canonical coordinator mutations
import {
	clampControlValue,
	type ControlApplyAck,
	type ControlMutation,
	type ControlOperation,
	type ControlOperationAck,
	type ControlOperationPayload,
	type ControlOperationRequest,
	type HotkeyAction,
	type HotkeyParams,
	type MediaTarget,
} from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { getActiveNativeMediaExecutor } from '../logic/native-media-executor';

const FULL_OUTPUT_FIELDS = new Set<ControlMutation['field']>([
	'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay',
]);
const TAB_FIELDS = new Set<ControlMutation['field']>(['tabMuted', 'tabPinned']);

function finiteParam(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function submitTrustedActivationControl(
	field: 'playing' | 'pip' | 'fullscreen',
	documentId?: string,
	target?: MediaTarget,
): Promise<{ target: import('@nexus/contracts').MediaTarget; actual: boolean }> {
	const executor = getActiveNativeMediaExecutor();
	if (!executor) throw new Error('The native media runtime is unavailable');
	if (documentId) executor.bindRequestContext(undefined, documentId);
	// The browser API is invoked synchronously inside the trusted keydown stack.
	// Only the observed actual value crosses Background afterwards. The explicit
	// target is the one the viewer selected; without it a multi-video page falls
	// back to whatever the registry happens to rank first.
	const result = await executor.toggleTrustedActivation(field, target);
	const response = await sendSpectraRequest('spectra.control.intent.submit', {
		source: 'page',
		requestedCoverage: 'active-target',
		target: result.target,
		patch: { [field]: result.actual },
		observedStrategies: { [field]: 'dom-native' },
	});
	if (!response.ok) throw new Error(response.error.message);
	return result;
}

export async function submitHotkeyMutations(
	mutations: readonly ControlMutation[],
): Promise<ControlApplyAck | undefined> {
	const target = mutations.filter((mutation) =>
		!FULL_OUTPUT_FIELDS.has(mutation.field) && !TAB_FIELDS.has(mutation.field));
	const full = mutations.filter((mutation) =>
		FULL_OUTPUT_FIELDS.has(mutation.field) || TAB_FIELDS.has(mutation.field));
	let acknowledgement: ControlApplyAck | undefined;
	for (const group of [
		...(target.length > 0 ? [{ requestedCoverage: 'active-target' as const, mutations: target }] : []),
		...(full.length > 0 ? [{ requestedCoverage: 'full' as const, mutations: full }] : []),
	]) {
		const response = await sendSpectraRequest('spectra.control.intent.submit', {
			source: 'hotkey',
			requestedCoverage: group.requestedCoverage,
			target: null,
			mutations: group.mutations,
		});
		if (!response.ok) throw new Error(response.error.message);
		acknowledgement = response.data;
		const failure = Object.values(response.data.fields)
			.find((field) => field?.phase !== 'applied');
		if (failure) throw new Error(failure.lastError?.message ?? 'Hotkey control was not applied');
	}
	return acknowledgement;
}

export async function submitHotkeyOperation<O extends ControlOperation>(
	operation: O,
	payload: ControlOperationPayload<O>,
): Promise<ControlOperationAck<O>> {
	const response = await sendSpectraRequest('spectra.control.operation.submit', {
		source: 'hotkey',
		target: null,
		operation,
		payload,
	} as unknown as ControlOperationRequest);
	if (!response.ok) throw new Error(response.error.message);
	const failure = Object.values(response.data.fields)
		.find((field) => field?.phase === 'error' && field.lastError);
	if (failure?.lastError) throw new Error(failure.lastError.message);
	return response.data as ControlOperationAck<O>;
}

export function sendVolumeAction(action: HotkeyAction, params?: HotkeyParams): Promise<unknown> {
	const configuredStep = finiteParam(params?.step);
	const step = configuredStep === undefined ? 10 : Math.abs(configuredStep);
	switch (action) {
		case 'volume_up':
			return submitHotkeyOperation('effective-volume', { operation: 'delta', value: step });
		case 'volume_down':
			return submitHotkeyOperation('effective-volume', { operation: 'delta', value: -step });
		case 'volume_mute':
			return submitHotkeyMutations([{ field: 'mediaMuted', operation: 'toggle' }]);
		case 'volume_set':
			{
				const volume = finiteParam(params?.volume);
				return volume !== undefined
					? submitHotkeyOperation('effective-volume', {
						operation: 'set',
						value: clampControlValue(volume, 'volume', 100),
					})
				: Promise.resolve();
			}
		default:
			return Promise.resolve();
	}
}

// eff: handles speed adjustment hotkeys through unified config flow
export function sendSpeedAction(action: HotkeyAction, params?: HotkeyParams): Promise<unknown> {
	const configuredStep = finiteParam(params?.step);
	const step = configuredStep === undefined ? 0.1 : Math.abs(configuredStep);
	switch (action) {
		case 'speed_up': return submitHotkeyMutations([{ field: 'speed', operation: 'delta', value: step }]);
		case 'speed_down': return submitHotkeyMutations([{ field: 'speed', operation: 'delta', value: -step }]);
		case 'speed_reset': return submitHotkeyMutations([{ field: 'speed', operation: 'set', value: 1 }]);
		case 'speed_set':
			{
				const speed = finiteParam(params?.speed);
				return speed !== undefined
					? submitHotkeyMutations([{
						field: 'speed',
						operation: 'set',
						value: clampControlValue(speed, 'speed', 1),
					}])
					: Promise.resolve();
			}
		default: return Promise.resolve();
	}
}

export function sendAudioAdjustment(action: HotkeyAction, params?: HotkeyParams): Promise<unknown> {
	const configuredStep = finiteParam(params?.step);
	const step = configuredStep === undefined ? undefined : Math.abs(configuredStep);
	let mutation: ControlMutation | null = null;
	switch (action) {
		case 'gain_up':
			return submitHotkeyOperation('effective-volume', {
				operation: 'delta', value: Math.min(8, step ?? 0.1) * 100,
			});
		case 'gain_down':
			return submitHotkeyOperation('effective-volume', {
				operation: 'delta', value: -Math.min(8, step ?? 0.1) * 100,
			});
		case 'delay_up': mutation = { field: 'delay', operation: 'delta', value: step ?? 10 }; break;
		case 'delay_down': mutation = { field: 'delay', operation: 'delta', value: -(step ?? 10) }; break;
		case 'delay_reset': mutation = { field: 'delay', operation: 'set', value: 0 }; break;
		case 'pan_left': mutation = { field: 'pan', operation: 'delta', value: -Math.min(1, step ?? 0.1) }; break;
		case 'pan_right': mutation = { field: 'pan', operation: 'delta', value: Math.min(1, step ?? 0.1) }; break;
		case 'pan_reset': mutation = { field: 'pan', operation: 'set', value: 0 }; break;
		case 'mono_toggle': mutation = { field: 'mono', operation: 'toggle' }; break;
	}
	if (!mutation) return Promise.resolve();
	return submitHotkeyMutations([mutation]);
}
