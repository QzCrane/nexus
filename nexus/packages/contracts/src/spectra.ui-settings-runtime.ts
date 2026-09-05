// goal: minimum audio-free runtime guards for Options and settings UI surfaces

import { isHotkeyTargetState } from './hotkey-target.contracts.js';
import {
	hasOnlyProtocolKeys,
	hasValidEventEnvelopeBase,
	isProtocolRecord,
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
} from './spectra.protocol-primitives.js';
import type {
	SpectraEventEnvelope,
	SpectraRequestType,
	SpectraResponse,
} from './spectra.protocol.js';
import { isSettingsUiSnapshot } from './settings-ui.contracts.js';

export {
	DEFAULT_GLOBAL_SETTINGS,
	SPECTRA_SETTINGS_SCHEMA_VERSION,
	isGlobalSettings,
	isHotkeySettings,
	isSettingsUiPatch,
	isSettingsUiPatchRequest,
	isSettingsUiSnapshot,
	toSettingsUiSnapshot,
} from './settings-ui.contracts.js';
export { SPECTRA_PROTOCOL_VERSION } from './spectra.protocol-primitives.js';
export type {
	GlobalSettings,
	HotkeySiteMutation,
	SettingsUiPatch,
	SettingsUiPatchRequest,
	SettingsUiSnapshot,
	SupportedLanguage,
	ThemeMode,
} from './settings-ui.contracts.js';
export type { SettingsSnapshot } from './settings.contracts.js';
export type { HotkeyAction } from './hotkeys.contracts.js';
export {
	DEFAULT_HOTKEY_SETTINGS,
	DEFAULT_MODIFIERS,
	HOTKEY_ACTIONS,
	HOTKEY_ACTION_DESCRIPTORS,
	isSpectraDefaultHotkeyKeyCombo,
	isSlotHotkeyAction,
	selectHotkeyAvailability,
	selectHotkeyParameterKind,
	selectHotkeyRepeatPolicy,
} from './hotkeys.contracts.js';
export { normalizeHostname } from './domain.contracts.js';

export const SPECTRA_SETTINGS_UI_REQUEST_TYPES = [
	'spectra.settings.ui.get',
	'spectra.settings.ui.patch',
	'spectra.settings.flush',
	'spectra.hotkey-target.get',
	'spectra.hotkey-target.set',
] as const satisfies readonly SpectraRequestType[];

export type SpectraSettingsUiRequestType = (typeof SPECTRA_SETTINGS_UI_REQUEST_TYPES)[number];
export type SpectraSettingsUiEventType = 'spectra.settings.ui.changed';

const SETTINGS_UI_REQUEST_TYPE_SET: ReadonlySet<SpectraRequestType> = new Set(
	SPECTRA_SETTINGS_UI_REQUEST_TYPES,
);
const EVENT_KEYS = new Set(['protocolVersion', 'tabId', 'documentId', 'generation', 'type', 'payload']);

export function isSpectraSettingsUiRequestType(
	value: unknown,
): value is SpectraSettingsUiRequestType {
	return typeof value === 'string'
		&& SETTINGS_UI_REQUEST_TYPE_SET.has(value as SpectraRequestType);
}

function isSettingsUiResponseData(type: SpectraSettingsUiRequestType, value: unknown): boolean {
	switch (type) {
		case 'spectra.settings.ui.get':
		case 'spectra.settings.ui.patch': return isSettingsUiSnapshot(value);
		case 'spectra.settings.flush': return isProtocolRecord(value)
			&& Object.keys(value).length === 1
			&& value.flushed === true;
		case 'spectra.hotkey-target.get':
		case 'spectra.hotkey-target.set': return isHotkeyTargetState(value);
	}
}

export function isSpectraSettingsUiResponse<T extends SpectraRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<Extract<T, SpectraSettingsUiRequestType>> {
	if (!isSpectraSettingsUiRequestType(type)) return false;
	if (isRpcSuccessResult(value)) return isSettingsUiResponseData(type, value.data);
	return isRpcFailureResult(value) && isRpcError(value.error);
}

export function isSpectraSettingsUiEventEnvelope(
	value: unknown,
): value is SpectraEventEnvelope<SpectraSettingsUiEventType> {
	return isProtocolRecord(value)
		&& hasValidEventEnvelopeBase(value)
		&& hasOnlyProtocolKeys(value, EVENT_KEYS)
		&& value.type === 'spectra.settings.ui.changed'
		&& value.tabId === undefined
		&& value.documentId === undefined
		&& value.generation === undefined
		&& isSettingsUiSnapshot(value.payload);
}
