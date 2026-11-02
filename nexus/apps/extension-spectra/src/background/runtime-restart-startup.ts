// goal: wire MV3 worker-restart runtime recovery through the existing loader lease authority
// inv: surviving heavy runtime is never disposed until every durable owner is reconstructed

import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	isDefaultAudioConfig,
	type AudioSessionSnapshot,
	type ContentRuntimeSourceOwnership,
	type ContentRuntimeStatus,
	type HotkeySettings,
} from '@nexus/contracts';
import { swLog } from '../shared/logger';
import { resolveSiteHotkeys, type SiteHotkeyRuntimeMode } from '../shared/site-hotkey-mode';
import { settingsRepository } from './settings-repository';
import { storage } from './state';
import { getAudioSession } from './audio-session-store';
import { RUNTIME_OWNER_CAPABILITY } from './control-coordinator';
import {
	ensureContentRuntime,
	reconcileHotkeyRuntimeLease,
	releaseContentRuntimeLease,
	MEDIA_INTENT_RUNTIME_CAPABILITY,
} from './runtime-loader';
import { recoverDocumentRuntimeAfterWorkerRestart } from './runtime-restart-recovery';
import { forEachBounded } from './bounded-fanout';
import { sendBackgroundTabRequestOnce } from './background-rpc';
import { mediaTabAvailability } from '../shared/media-card-policy';

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
	readonly mediaIntentState?: ContentRuntimeStatus['mediaIntentState'];
}

export interface RuntimeRestartStartupPort {
	readStatus(target: RuntimeRestartTarget): Promise<RuntimeRestartStatus>;
	retainRecoveryRuntime(target: RuntimeRestartTarget): Promise<void>;
	releaseRecoveryRuntime(target: RuntimeRestartTarget): void;
	resolvePersistentRestoreCapability(target: RuntimeRestartTarget): Promise<string | null>;
	retainRestoreRuntime(target: RuntimeRestartTarget, capability: string): Promise<void>;
	/** True when the persisted processor session demands the content runtime stay alive. */
	resolvePersistentAudioSession(target: RuntimeRestartTarget): Promise<boolean>;
	retainAudioSessionRuntime(target: RuntimeRestartTarget): Promise<void>;
	reconcileHotkeys(target: RuntimeRestartTarget, settings: HotkeySettings): Promise<SiteHotkeyRuntimeMode>;
}

// A held audio processor session (live, and required to keep amplifying/DSP-ing
// the media) is owned by the content runtime. Its persisted snapshot is the
// durable truth that must survive an MV3 worker restart: otherwise the startup
// orphan sweep disposes the runtime, destroying the webaudio/capture session,
// and the next up-cross (>100 boundary) cold-starts the processor.
function isPersistedProcessorSession(snapshot: AudioSessionSnapshot): boolean {
	return (snapshot.actualMode === 'capture' || snapshot.actualMode === 'webaudio')
		&& snapshot.phase === 'active';
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
	const capability = MEDIA_INTENT_RUNTIME_CAPABILITY;
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
	async resolvePersistentAudioSession(target) {
		const snapshot = await getAudioSession(target.tabId).catch(() => null);
		return snapshot !== null && isPersistedProcessorSession(snapshot);
	},
	async retainAudioSessionRuntime(target) {
		// Reuse the exact owned-control lease a live commit would hold. The next
		// reconcileRuntimeOwnership sees it already acquired and skips re-ensure;
		// when the processor ownership flips back to neutral it releases this same
		// lease through the canonical path, so no dedicated teardown wiring is needed.
		const ready = await ensureContentRuntime(
			target.tabId,
			target.documentId,
			'control',
			RUNTIME_OWNER_CAPABILITY,
		);
		if (ready.documentId !== target.documentId) {
			releaseContentRuntimeLease(
				target.tabId,
				ready.documentId,
				'control',
				RUNTIME_OWNER_CAPABILITY,
			);
			throw new Error('Audio-session hold retained a stale runtime document');
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
	let survivingMediaIntent: ContentRuntimeStatus['mediaIntentState'];

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
			survivingMediaIntent = status.mediaIntentState;
			durableOwner = hasOwnedSource(status);
			await port.retainRecoveryRuntime(target);
			recoveryLeaseHeld = true;
			return true;
		},
		async restoreDocumentOwnership() {
			// A surviving executor owns its template. Resource/session actuals may
			// reflect an unchangeable 1x live stream or a released page baseline;
			// neither is proof that a document replay template still exists.
			const restoreCapability = runtimeWasPresent && survivingMediaIntent !== undefined && survivingMediaIntent !== 'unset'
				? survivingMediaIntent === 'retained' ? MEDIA_INTENT_RUNTIME_CAPABILITY : null
				: await port.resolvePersistentRestoreCapability(target);
			if (restoreCapability) {
				durableOwner = true;
				// Do not create a new heavy runtime solely for restart recovery. If one
				// survived, retain it with exactly the capability normal restore owns;
				// otherwise bootstrap initialization remains the load boundary.
				if (runtimeWasPresent) await port.retainRestoreRuntime(target, restoreCapability);
				return;
			}
			// A persisted live processor session is itself a durable owner. Without
			// this retain, the orphan sweep below disposes the runtime and the held
			// webaudio/capture session with it, forcing a cold processor start on the
			// next >100 crossing. Retention follows the same "only for a survivor"
			// rule: a dead runtime is not resurrected just to hold a session.
			if (await port.resolvePersistentAudioSession(target)) {
				durableOwner = true;
				if (runtimeWasPresent) await port.retainAudioSessionRuntime(target);
			}
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

async function currentHttpTargets(retryOnly?: ReadonlyMap<number, RuntimeRestartTarget>): Promise<RuntimeRestartTarget[]> {
	const tabs = await chrome.tabs.query({});
	const targets: RuntimeRestartTarget[] = [];
	await forEachBounded(tabs, 8, async (tab) => {
		if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url
			|| !/^https?:/u.test(tab.url) || mediaTabAvailability(tab) !== 'runnable') return;
		const tabId = Number(tab.id);
		if (retryOnly && !retryOnly.has(tabId)) return;
		const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
		if (!frame?.documentId || !frame.url || !/^https?:/u.test(frame.url)) return;
		if (retryOnly && retryOnly.get(tabId)?.documentId !== frame.documentId) return;
		targets.push({ tabId, documentId: frame.documentId, url: frame.url });
	});
	return targets;
}

interface RuntimeRestartRecoveryDependencies {
	readSettings(): Promise<HotkeySettings>;
	discoverTargets(retryOnly?: ReadonlyMap<number, RuntimeRestartTarget>): Promise<RuntimeRestartTarget[]>;
	recover(target: RuntimeRestartTarget, settings: HotkeySettings): Promise<void>;
	schedule(callback: () => void, delay: number): void;
}

const restartRecoveryDependencies: RuntimeRestartRecoveryDependencies = {
	readSettings: async () => (await settingsRepository.getSnapshot()).hotkeySettings,
	discoverTargets: currentHttpTargets,
	recover: recoverDocumentRuntimeOnWorkerStartup,
	schedule: (callback, delay) => { setTimeout(callback, delay); },
};

export function initializeRuntimeRestartRecovery(dependencies: RuntimeRestartRecoveryDependencies = restartRecoveryDependencies): void {
	let attempt = 0;
	let retryScheduled = false;

	const scheduleRetry = (reason: unknown, phase: 'document' | 'discovery', retryOnly?: ReadonlyMap<number, RuntimeRestartTarget>): void => {
		const delay = retryDelayForAttempt(attempt);
		if (delay === null || retryScheduled) return;
		attempt += 1;
		swLog.warn(`[Runtime] restart recovery ${phase} failure; retrying: ${String(reason)}`);
		retryScheduled = true;
		dependencies.schedule(() => {
			retryScheduled = false;
			void run(retryOnly);
		}, delay);
	};

	const run = async (retryOnly?: ReadonlyMap<number, RuntimeRestartTarget>): Promise<void> => {
		try {
			const settings = await dependencies.readSettings();
			const targets = await dependencies.discoverTargets(retryOnly);
			const failures = new Map<number, RuntimeRestartTarget>();
			await forEachBounded(targets, 4, async (target) => {
				await dependencies.recover(target, settings).catch((error) => {
					failures.set(target.tabId, target);
					swLog.warn(`[Runtime] restart recovery failed: ${String(error)}`);
				});
			});
			if (failures.size === 0) {
				attempt = 0;
				return;
			}
			// A failed document does not invalidate healthy ownership proofs. The
			// next discovery rechecks only these ids and still requires runnable
			// tabs with the same document identity before another page RPC.
			scheduleRetry(`${failures.size} document recovery operation(s) failed`, 'document', failures);
		} catch (error) {
			scheduleRetry(error, 'discovery', retryOnly);
		}
	};

	void run();
}

export const runtimeRestartStartupTestApi = {
	currentHttpTargets,
	initialize: initializeRuntimeRestartRecovery,
	RECOVERY_CAPABILITY,
	RETRY_DELAYS_MS,
	hasOwnedSource,
	retryDelayForAttempt,
};
