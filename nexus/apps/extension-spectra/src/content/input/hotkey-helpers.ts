// goal: translate content hotkeys into canonical coordinator mutations
import type {
	ControlMutation,
	ControlOperation,
	ControlOperationAck,
	ControlOperationPayload,
	ControlOperationRequest,
	HotkeyAction,
	HotkeyParams,
} from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { getActiveNativeMediaExecutor } from '../logic/native-media-executor';

const FULL_OUTPUT_FIELDS = new Set<ControlMutation['field']>([
	'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay',
]);
const TAB_FIELDS = new Set<ControlMutation['field']>(['tabMuted', 'tabPinned']);

export async function submitTrustedActivationHotkey(
	field: 'playing' | 'pip' | 'fullscreen',
): Promise<void> {
	const executor = getActiveNativeMediaExecutor();
	if (!executor) throw new Error('The native media runtime is unavailable');
	// The browser API is invoked synchronously inside the trusted keydown stack.
	// Only the observed actual value crosses Background afterwards.
	const result = await executor.toggleTrustedActivation(field);
	const response = await sendSpectraRequest('spectra.control.intent.submit', {
		source: 'page',
		requestedCoverage: 'active-target',
		target: result.target,
		patch: { [field]: result.actual },
	});
	if (!response.ok) throw new Error(response.error.message);
}

export async function submitHotkeyMutations(mutations: readonly ControlMutation[]): Promise<void> {
	const target = mutations.filter((mutation) =>
		!FULL_OUTPUT_FIELDS.has(mutation.field) && !TAB_FIELDS.has(mutation.field));
	const full = mutations.filter((mutation) =>
		FULL_OUTPUT_FIELDS.has(mutation.field) || TAB_FIELDS.has(mutation.field));
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
		const failure = Object.values(response.data.fields)
			.find((field) => field?.phase !== 'applied');
		if (failure) throw new Error(failure.lastError?.message ?? 'Hotkey control was not applied');
	}
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
	return response.data as ControlOperationAck<O>;
}

export function sendVolumeAction(action: HotkeyAction, params?: HotkeyParams): Promise<void> {
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : 10;
	const mutations: ControlMutation[] = [];
	switch (action) {
		case 'volume_up':
			mutations.push({ field: 'volumeBase', operation: 'delta', value: step });
			break;
		case 'volume_down':
			mutations.push({ field: 'volumeBase', operation: 'delta', value: -step });
			break;
		case 'volume_mute': mutations.push({ field: 'mediaMuted', operation: 'toggle' }); break;
		case 'volume_set':
			if (Number.isFinite(params?.volume)) {
				mutations.push({
					field: 'volumeBase',
					operation: 'set',
					value: Math.max(0, Math.min(100, params!.volume!)),
				});
			}
			break;
	}
	return mutations.length > 0 ? submitHotkeyMutations(mutations) : Promise.resolve();
}

// eff: handles speed adjustment hotkeys through unified config flow
export function sendSpeedAction(action: HotkeyAction, params?: HotkeyParams): Promise<void> {
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : 0.1;
	switch (action) {
		case 'speed_up': return submitHotkeyMutations([{ field: 'speed', operation: 'delta', value: step }]);
		case 'speed_down': return submitHotkeyMutations([{ field: 'speed', operation: 'delta', value: -step }]);
		case 'speed_reset': return submitHotkeyMutations([{ field: 'speed', operation: 'set', value: 1 }]);
		case 'speed_set':
			return Number.isFinite(params?.speed)
				? submitHotkeyMutations([{ field: 'speed', operation: 'set', value: Math.max(0.1, Math.min(16, params!.speed!)) }])
				: Promise.resolve();
		default: return Promise.resolve();
	}
}

export function sendAudioAdjustment(action: HotkeyAction, params?: HotkeyParams): Promise<void> {
	const step = Number.isFinite(params?.step) ? Math.abs(params!.step!) : undefined;
	let mutation: ControlMutation | null = null;
	switch (action) {
		case 'gain_up':
			mutation = { field: 'boost', operation: 'delta', value: Math.min(1, step ?? 0.1) };
			break;
		case 'gain_down':
			mutation = { field: 'boost', operation: 'delta', value: -Math.min(1, step ?? 0.1) };
			break;
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

export async function toggleLoop(): Promise<void> {
	await submitHotkeyMutations([{ field: 'loop', operation: 'toggle' }]);
}

export function sendTabAction(action: HotkeyAction): Promise<void> {
	return submitHotkeyMutations([{
		field: action === 'tab_pin' ? 'tabPinned' : 'tabMuted',
		operation: 'toggle',
	}]);
}
