// goal: thin runtime-loader adapter for site-hotkey ownership
// eff: classification and heavy-listener projection stay outside the generic Content Runtime lease state machine

import {
	SPECTRA_PROTOCOL_VERSION,
	type HotkeySettings,
} from '@nexus/contracts';
import { resolveSiteHotkeys } from '../shared/site-hotkey-mode';
import {
	siteHotkeyDocumentOwner,
	type FullSiteHotkeyRuntimePort,
} from './site-hotkey-owner';

const NO_RECEIVER_FRAGMENT = 'Receiving end does not exist';

export interface HeavyRuntimeLeasePort {
	ensure(capability: string): Promise<void>;
	release(capability: string): void;
}

function isMissingReceiver(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(NO_RECEIVER_FRAGMENT);
}

async function projectHeavySiteHotkeySettings(
	tabId: number,
	documentId: string,
	settings: HotkeySettings,
	allowAbsent: boolean,
): Promise<void> {
	try {
		await chrome.tabs.sendMessage(tabId, {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.hotkeys.changed',
			payload: settings,
		}, { documentId });
	} catch (error) {
		if (allowAbsent && isMissingReceiver(error)) return;
		throw error;
	}
}

function heavyRuntimeOwnershipPort(
	tabId: number,
	documentId: string,
	settings: HotkeySettings,
	leasePort: HeavyRuntimeLeasePort,
): FullSiteHotkeyRuntimePort {
	return {
		async suspend() {
			// content-runtime.js may remain alive for restore/observation/control
			// leases. Empty only its configured-site domain so lean/none cannot have
			// a second keydown owner. Missing runtime is already suspended.
			await projectHeavySiteHotkeySettings(
				tabId,
				documentId,
				{ ...settings, sites: {} },
				true,
			);
		},
		async ensure(capability) {
			await leasePort.ensure(capability);
			try {
				// A surviving heavy runtime may have been explicitly suspended by a
				// previous lean generation. READY alone is not enough; restore the
				// current exact settings before declaring full ownership established.
				await projectHeavySiteHotkeySettings(tabId, documentId, settings, false);
			} catch (error) {
				leasePort.release(capability);
				throw error;
			}
		},
		release: (capability) => leasePort.release(capability),
	};
}

export async function reconcileDocumentSiteHotkeys(
	tabId: number,
	documentId: string,
	url: string | undefined,
	settings: HotkeySettings,
	fullRuntime: HeavyRuntimeLeasePort,
): Promise<void> {
	await siteHotkeyDocumentOwner.reconcile(
		tabId,
		documentId,
		resolveSiteHotkeys(url, settings),
		heavyRuntimeOwnershipPort(tabId, documentId, settings, fullRuntime),
	);
}

export function forgetDocumentSiteHotkeys(tabId: number, documentId?: string): void {
	siteHotkeyDocumentOwner.forget(tabId, documentId);
}

export function resetDocumentSiteHotkeysForTests(): void {
	siteHotkeyDocumentOwner.reset();
}

export const siteHotkeyLoaderAdapterTestApi = {
	projectHeavySiteHotkeySettings,
	heavyRuntimeOwnershipPort,
};
