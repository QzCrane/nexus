// goal: wire MV3 worker-restart runtime recovery through the existing loader lease authority
// inv: surviving heavy runtime is never disposed until every durable owner is reconstructed

import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	isDefaultAudioConfig,
	type ContentRuntimeSourceOwnership,
	type HotkeySettings,
} from '@nexus/contracts';
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
import { forEachBounded } from './bounded-fanout';
import { sendBackgroundTabRequestOnce } from './background-rpc';

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
	resolvePersistentRestoreCapability(target: RuntimeRestartTarget): Promise<string | null>;
	retainRestoreRuntime(target: RuntimeRestartTarget, capability: string): Promise<void>;
	reconcileHotkeys(target: RuntimeRestartTarget, settings: HotkeySettings): Promise<SiteHotkeyRuntimeMode>;
}

function hasOwnedSource(status: RuntimeRestartStatus): boolean {
	return status.ownedSources.some((owned) => owned.markerCount > 0 || owned.abActive);
}

function retryDelayForAttempt(attempt: number): number | null {
	return RETRY_DELAYS_MS[attempt] ?? null;
}

async function persistentRestoreCapability(target: RuntimeRestartTarget): Promise<string | null> {
	let identity: ReturnType<typeof storage.tabSession.identity>;
	try {
		identity = storage.tabSession.identity(target.tabId, target.documentId, target.url);
	} catch {
		return null;
	}
	const hostname = new URL(identity.resourceUrl).hostname;
	const capability = `settings:${hostname}`;
	const sessionPatch = await storage.tabSession.rebind(target.tabId, identity);
	if (sessionPatch && Object.keys(sessionPatch).length > 0) return capability;
	const config = await settingsRepository.resolveAudioConfig(hostname);
	return isDefaultAudioConfig(config) ? null : capability;
}

const chromePort: RuntimeRestartStartupPort = {
	async readStatus(target) {
		const response = await sendBackgroundTabRequestOnce(
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
	resolvePersistentRestoreCapability: persistentRestoreCapability,
	async retainRestoreRuntime(target, capability) {
		const ready = await ensureContentRuntime(
			target.tabId,
			target.documentId,
			'restore',
			capability,
		);
		if (ready.documentId !== target.documentId) {
			releaseContentRuntimeLease(target.tabId, ready.documentId, 'restore', capability);
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
			const restoreCapability = await port.resolvePersistentRestoreCapability(target);
			if (!restoreCapability) return;
			durableOwner = true;
			// Do not create a new heavy runtime solely for restart recovery. If one
			// survived, retain it with exactly the capability normal restore owns;
			// otherwise bootstrap initialization remains the load boundary.
			if (runtimeWasPresent) await port.retainRestoreRuntime(target, restoreCapability);
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
	const targets: RuntimeRestartTarget[] = [];
	await forEachBounded(tabs, 8, async (tab) => {
		if (!tab.id) return;
		const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
		if (!frame?.documentId || !frame.url || !/^https?:/u.test(frame.url)) return;
		targets.push({ tabId: tab.id, documentId: frame.documentId, url: frame.url });
	});
	return targets;
}

export function initializeRuntimeRestartRecovery(): void {
	let attempt = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	const scheduleRetry = (reason: unknown, phase: 'document' | 'discovery'): void => {
		const delay = retryDelayForAttempt(attempt);
		if (delay === null || retryTimer) return;
		attempt += 1;
		swLog.warn(`[Runtime] restart recovery ${phase} failure; retrying: ${String(reason)}`);
		retryTimer = setTimeout(() => {
			retryTimer = null;
			void run();
		}, delay);
	};

	const run = async (): Promise<void> => {
		try {
			const snapshot = await settingsRepository.getSnapshot();
			const targets = await currentHttpTargets();
			const failures: unknown[] = [];
			await forEachBounded(targets, 4, async (target) => {
				await recoverDocumentRuntimeOnWorkerStartup(target, snapshot.hotkeySettings)
					.catch((error) => { failures.push(error); });
			});
			if (failures.length === 0) {
				attempt = 0;
				return;
			}
			for (const failure of failures) swLog.warn(`[Runtime] restart recovery failed: ${String(failure)}`);
			scheduleRetry(`${failures.length} document recovery operation(s) failed`, 'document');
		} catch (error) {
			scheduleRetry(error, 'discovery');
		}
	};

	void run();
}

export const runtimeRestartStartupTestApi = {
	RECOVERY_CAPABILITY,
	RETRY_DELAYS_MS,
	hasOwnedSource,
	retryDelayForAttempt,
};
