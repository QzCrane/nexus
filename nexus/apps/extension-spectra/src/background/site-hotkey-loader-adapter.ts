// goal: thin runtime-loader adapter for site-hotkey ownership
// eff: URL/settings classification stays outside the heavy Content Runtime loader state machine

import type { HotkeySettings } from '@nexus/contracts';
import { resolveSiteHotkeys } from '../shared/site-hotkey-mode';
import {
	siteHotkeyDocumentOwner,
	type FullSiteHotkeyRuntimePort,
} from './site-hotkey-owner';

export async function reconcileDocumentSiteHotkeys(
	tabId: number,
	documentId: string,
	url: string | undefined,
	settings: HotkeySettings,
	fullRuntime: FullSiteHotkeyRuntimePort,
): Promise<void> {
	await siteHotkeyDocumentOwner.reconcile(
		tabId,
		documentId,
		resolveSiteHotkeys(url, settings),
		fullRuntime,
	);
}

export function forgetDocumentSiteHotkeys(tabId: number, documentId?: string): void {
	siteHotkeyDocumentOwner.forget(tabId, documentId);
}

export function resetDocumentSiteHotkeysForTests(): void {
	siteHotkeyDocumentOwner.reset();
}
