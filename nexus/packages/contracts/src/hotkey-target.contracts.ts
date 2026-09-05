// goal: defines the extension-owned tab selected for global hotkey actions

export interface HotkeyTargetState {
	tabId: number | null;
}

const HOTKEY_TARGET_STATE_KEYS = new Set(['tabId']);

export function isHotkeyTargetState(value: unknown): value is HotkeyTargetState {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return Object.keys(candidate).every((key) => HOTKEY_TARGET_STATE_KEYS.has(key))
		&& Object.keys(candidate).length === HOTKEY_TARGET_STATE_KEYS.size
		&& (candidate.tabId === null
			|| (Number.isSafeInteger(candidate.tabId) && Number(candidate.tabId) > 0));
}
