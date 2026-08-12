// goal: wire MV3 worker-restart runtime recovery through the existing loader lease authority
// inv: surviving heavy runtime is never disposed until every durable owner is reconstructed

import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	isDefaultAudioConfig,
	type ContentRuntimeSourceOwnership,
	type HotkeySettings,
} from '@nexus/contracts';
import { sendSpectraTabRequest } from '../shared/spectra-client';
import { swLog } from '../shared/logger';
import { resolveSiteHotkeys, type SiteHotkeyRuntimeMode } from '../shared/site-hotkey-mode';
import { settingsRepository } from './settings-repository';
import { storage } from './state';
import {
	ensureContentRuntime,
	reconcileHotkeyRuntimeLease,
	releaseContentRuntimeLease,
} from './runtime-loader';
import { recoverDocumentRuntimeAfterWorkerRestart } from './runtime-restart-recovery';

const RECOVERY_CAPABILITY = 'worker-restart-recovery';
const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

export interface RuntimeRestartTarget {
	readonly tabId: number;
	readonly documentId: string;
	readonly url: string;
}

export interface RuntimeRestartStatus {
	readonly ready: boolean;
	readonly runtimeRevision: string | null;
	readonly ownedSources: readonly ContentRuntimeSourceOwnership[];
}

export interface RuntimeRestartStartupPort {
	readStatus(target: RuntimeRestartTarget): Promise<RuntimeRestartStatus>;
	retainRecoveryRuntime(target: RuntimeRestartTarget): Promise<void>;
	releaseRecoveryRuntime(target: RuntimeRestartTarget): void;
	hasPersistentRestoreOwner(target: RuntimeRestartTarget): Promise<boolean>;
	retainRestoreRuntime(target: RuntimeRestartTarget): Promise<void>;
	reconcileHotkeys(target: RuntimeRestartTarget, settings: HotkeySettings): Promise<SiteHotkeyRuntimeMode>;
}

function hasOwnedSource(status: RuntimeRestartStatus): boolean {
	return status.ownedSources.some((owned) => owned.markerCount > 0 || owned.abActive);
}

async function persistentRestoreOwner(target: RuntimeRestartTarget): Promise<boolean> {
	let identity: ReturnType<typeof storage.tabSession.identity>;
	try {
		identity = storage.tabSession.identity(target.tabId, target.documentId, target.url);
	} catch {
		return false;
	}
	const sessionPatch = await storage.tabSession.rebind(target.tabId, identity);
	if (sessionPatch && Object.keys(sessionPatch).length > 0) return true;
	const config = await settingsRepository.resolveAudioConfig(new URL(identity.resourceUrl).hostname);
	return !isDefaultAudioConfig(config);
}

const chromePort: RuntimeRestartStartupPort = {
	async readStatus(target) {
		const response = await sendSpectraTabRequest(
			target.tabId,
			'spectra.content.runtime.status',
			{},
			{ documentId: target.documentId },
		);
		if (!response.ok) throw new Error(`Runtime status failed: ${response.error.code}`);
		return response.data;
	},
	async retainRecoveryRuntime(target) {
		const ready = await ensureContentRuntime(
			target.tabId,
			target.documentId,
			'observation',
			RECOVERY_CAPABILITY,
		);
		if (ready.documentId !== target.documentId) {
			releaseContentRuntimeLease(target.tabId, ready.documentId, 'observation', RECOVERY_CAPABILITY);
			throw new Error('Worker-restart recovery acquired a stale runtime document');
		}
	},
	releaseRecoveryRuntime(target) {
		releaseContentRuntimeLease(target.tabId, target.documentId, 'observation', RECOVERY_CAPABILITY);
	},
	hasPersistentRestoreOwner: persistentRestoreOwner,
	async retainRestoreRuntime(target) {
		const hostname = new URL(target.url).hostname;
		const ready = await ensureContentRuntime(
			target.tabId,
			target.documentId,
			'restore',
			`settings:${hostname}`,
		);
		if (ready.documentId !== target.documentId) {
			releaseContentRuntimeLease(target.tabId, ready.documentId, 'restore', `settings:${hostname}`);
			throw new Error('Worker-restart restore owner resolved to a stale document');
		}
	},
	async reconcileHotkeys(target, settings) {
		const resolved = resolveSiteHotkeys(target.url, settings);
		await reconcileHotkeyRuntimeLease(
			target.tabId,
			target.documentId,
			target.url,
			settings,
		);
		return resolved?.mode ?? 'none';
	},
};

export async function recoverDocumentRuntimeOnWorkerStartup(
	target: RuntimeRestartTarget,
	settings: HotkeySettings,
	port: RuntimeRestartStartupPort = chromePort,
): Promise<void> {
	let runtimeWasPresent = false;
	let recoveryLeaseHeld = false;
	let durableOwner = false;

	await recoverDocumentRuntimeAfterWorkerRestart({
		async probeExistingRuntime() {
			const status = await port.readStatus(target);
			if (!status.ready) {
				// A previous failed recovery may have retained the fixed probe lease.
				// A bootstrap-confirmed non-ready runtime makes that stale lease safe to clear.
				port.releaseRecoveryRuntime(target);
				return false;
			}
			if (status.runtimeRevision !== SPECTRA_CONTENT_RUNTIME_REVISION) {
				throw new Error(`Unexpected surviving runtime revision: ${String(status.runtimeRevision)}`);
			}
			runtimeWasPresent = true;
			durableOwner = hasOwnedSource(status);
			await port.retainRecoveryRuntime(target);
			recoveryLeaseHeld = true;
			return true;
		},
		async restoreDocumentOwnership() {
			const hasRestoreOwner = await port.hasPersistentRestoreOwner(target);
			if (!hasRestoreOwner) return;
			durableOwner = true;
			// Do not create a new heavy runtime solely for restart recovery. If one
			// survived, retain it under the same restore capability that normal
			// document initialization owns; otherwise bootstrap initialization remains
			// the load boundary.
			if (runtimeWasPresent) await port.retainRestoreRuntime(target);
		},
		async reconcileHotkeyOwnership() {
			const mode = await port.reconcileHotkeys(target, settings);
			if (mode === 'full') durableOwner = true;
		},
		hasRuntimeLease() {
			return durableOwner;
		},
		async disposeOrphanRuntime() {
			if (!recoveryLeaseHeld) return;
			// Actual disposal stays inside runtime-loader. Releasing the fixed probe
			// lease re-checks all concurrent/transient leases before RELEASE is sent.
			port.releaseRecoveryRuntime(target);
			recoveryLeaseHeld = false;
		},
	});

	// A durable source/restore/full-hotkey owner now protects the runtime through
	// its own canonical lease. Drop only the temporary restart probe.
	if (recoveryLeaseHeld) port.releaseRecoveryRuntime(target);
}

async function currentHttpTargets(): Promise<RuntimeRestartTarget[]> {
	const tabs = await chrome.tabs.query({});
	const targets = await Promise.all(tabs.map(async (tab): Promise<RuntimeRestartTarget | null> => {
		if (!tab.id) return null;
		const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
		if (!frame?.documentId || !frame.url || !/^https?:/u.test(frame.url)) return null;
		return { tabId: tab.id, documentId: frame.documentId, url: frame.url };
	}));
	return targets.filter((target): target is RuntimeRestartTarget => target !== null);
}

export function initializeRuntimeRestartRecovery(): void {
	let attempt = 0;
	const run = async (): Promise<void> => {
		const snapshot = await settingsRepository.getSnapshot();
		const targets = await currentHttpTargets();
		const results = await Promise.allSettled(targets.map((target) => (
			recoverDocumentRuntimeOnWorkerStartup(target, snapshot.hotkeySettings)
		)));
		const failures = results.filter((result) => result.status === 'rejected');
		if (failures.length === 0) return;
		for (const failure of failures) {
			if (failure.status === 'rejected') swLog.warn(`[Runtime] restart recovery failed: ${String(failure.reason)}`);
		}
		if (attempt >= RETRY_DELAYS_MS.length) return;
		const delay = RETRY_DELAYS_MS[attempt++] ?? 4_000;
		setTimeout(() => { void run(); }, delay);
	};
	void run().catch((error) => swLog.warn(`[Runtime] restart recovery discovery failed: ${String(error)}`));
}

export const runtimeRestartStartupTestApi = {
	RECOVERY_CAPABILITY,
	RETRY_DELAYS_MS,
	hasOwnedSource,
};
