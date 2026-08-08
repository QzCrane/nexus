// goal: classify custom-site hotkeys by the smallest runtime that can preserve their semantics
// inv: lean mode is allowed only when every live binding is exactly representable by the existing page-default trigger protocol

import {
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	type SpectraDefaultHotkeyAction,
} from '@nexus/contracts/bootstrap';
import {
	findBestHostnameMatch,
	normalizeHostname,
	type HotkeyBinding,
	type HotkeySettings,
	type SiteHotkeyConfig,
} from '@nexus/contracts';

const DEFAULT_PAGE_ACTIONS: ReadonlySet<string> = new Set(SPECTRA_DEFAULT_HOTKEY_ACTIONS);
const LEAN_REPEATABLE_ACTIONS: ReadonlySet<SpectraDefaultHotkeyAction> = new Set([
	'speed_up',
	'speed_down',
	'volume_up',
	'volume_down',
]);

export type SiteHotkeyRuntimeMode = 'none' | 'lean' | 'full';

export interface ResolvedSiteHotkeys {
	domain: string;
	mode: Exclude<SiteHotkeyRuntimeMode, 'none'>;
	site: SiteHotkeyConfig;
}

export function isLiveSiteHotkeyBinding(binding: HotkeyBinding): boolean {
	return binding.enabled && !binding.disabledReason;
}

// The lean host intentionally reuses `spectra.content.default-hotkey.trigger`.
// Therefore it may accept only the five canonical page-default actions and only
// their canonical step sizes. A custom `params.step` or any other action falls
// back to the full runtime instead of silently changing behavior.
export function isLeanSiteHotkeyBinding(binding: HotkeyBinding): boolean {
	if (!isLiveSiteHotkeyBinding(binding) || !DEFAULT_PAGE_ACTIONS.has(binding.action)) return false;
	return binding.params === undefined || Object.keys(binding.params).length === 0;
}

export function isLeanRepeatableSiteHotkeyAction(
	action: string,
): action is SpectraDefaultHotkeyAction {
	return LEAN_REPEATABLE_ACTIONS.has(action as SpectraDefaultHotkeyAction);
}

export function resolveSiteHotkeys(
	url: string | undefined,
	settings: HotkeySettings,
): ResolvedSiteHotkeys | null {
	if (!url) return null;
	let hostname: string | null = null;
	try {
		hostname = normalizeHostname(new URL(url).hostname);
	} catch {
		return null;
	}
	if (!hostname) return null;

	const match = findBestHostnameMatch(
		hostname,
		Object.entries(settings.sites),
		([domain]) => domain,
	);
	if (!match) return null;
	const [domain, site] = match;
	if (!site.enabled) return null;
	const liveBindings = site.bindings.filter(isLiveSiteHotkeyBinding);
	if (liveBindings.length === 0) return null;
	return {
		domain,
		site,
		mode: liveBindings.every(isLeanSiteHotkeyBinding) ? 'lean' : 'full',
	};
}

export function siteHotkeyCapability(resolved: ResolvedSiteHotkeys | null): string | null {
	return resolved ? `site:${resolved.domain}` : null;
}
