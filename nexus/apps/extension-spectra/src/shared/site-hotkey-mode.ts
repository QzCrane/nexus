// goal: classify custom-site hotkeys by the smallest runtime that can preserve their semantics
// inv: lean mode is allowed only when every live binding is exactly representable by the existing page-default trigger protocol

import {
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	isSpectraRepeatableDefaultHotkeyAction,
	type SpectraDefaultHotkeyAction,
	type SpectraLeanSiteHotkeyBinding,
} from '@nexus/contracts/bootstrap';
import {
	HOTKEY_ACTION_DESCRIPTORS,
	findBestHostnameMatch,
	normalizeHostname,
	type HotkeyBinding,
	type HotkeySettings,
	type SiteHotkeyConfig,
} from '@nexus/contracts';

const DEFAULT_PAGE_ACTIONS: ReadonlySet<string> = new Set(SPECTRA_DEFAULT_HOTKEY_ACTIONS);

export type SiteHotkeyRuntimeMode = 'none' | 'lean' | 'full';

export interface ResolvedSiteHotkeys {
	domain: string;
	mode: Exclude<SiteHotkeyRuntimeMode, 'none'>;
	site: SiteHotkeyConfig;
}

export function isLiveSiteHotkeyBinding(binding: HotkeyBinding): boolean {
	return binding.enabled
		&& !binding.disabledReason
		&& HOTKEY_ACTION_DESCRIPTORS[binding.action]?.availability === 'enabled';
}

export function isLeanSiteHotkeyBinding(
	binding: HotkeyBinding,
): binding is HotkeyBinding & { action: SpectraDefaultHotkeyAction } {
	if (!isLiveSiteHotkeyBinding(binding) || !DEFAULT_PAGE_ACTIONS.has(binding.action)) return false;
	return binding.params === undefined || Object.keys(binding.params).length === 0;
}

export function isLeanRepeatableSiteHotkeyAction(
	action: string,
): action is SpectraDefaultHotkeyAction {
	return isSpectraRepeatableDefaultHotkeyAction(action);
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
	// The most-specific configured domain is authoritative. An explicit disabled
	// child domain suppresses an enabled parent instead of falling through.
	if (!site.enabled) return null;
	const liveBindings = site.bindings.filter(isLiveSiteHotkeyBinding);
	if (liveBindings.length === 0) return null;
	return {
		domain,
		site,
		mode: liveBindings.every(isLeanSiteHotkeyBinding) ? 'lean' : 'full',
	};
}

export function leanSiteHotkeyBindings(
	resolved: ResolvedSiteHotkeys | null,
): SpectraLeanSiteHotkeyBinding[] | null {
	if (resolved?.mode !== 'lean') return null;
	return resolved.site.bindings
		.filter(isLeanSiteHotkeyBinding)
		.map((binding) => ({
			code: binding.key.code,
			modifiers: {
				ctrl: binding.key.modifiers.ctrl,
				alt: binding.key.modifiers.alt,
				shift: binding.key.modifiers.shift,
				meta: binding.key.modifiers.meta,
			},
			action: binding.action,
		}));
}

export function siteHotkeyCapability(resolved: ResolvedSiteHotkeys | null): string | null {
	return resolved ? `site:${resolved.domain}` : null;
}
