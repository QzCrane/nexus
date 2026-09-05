// goal: one revision-aware cache, queue, and conflict retry primitive for settings clients

import type { RpcResult } from '@nexus/contracts';

export interface RevisionedSnapshot {
	revision: number;
}

export interface RevisionedPatchRequest<Patch> {
	expectedRevision: number;
	patch: Patch;
}

export interface RevisionedSettingsTransport<Snapshot extends RevisionedSnapshot, Patch> {
	getSnapshot(forceRefresh?: boolean): Promise<Snapshot>;
	sendPatch(request: RevisionedPatchRequest<Patch>): Promise<RpcResult<Snapshot>>;
}

export interface RevisionedSettingsClient<Snapshot extends RevisionedSnapshot, Patch> {
	getSnapshot(forceRefresh?: boolean): Promise<Snapshot>;
	patch(patch: Patch): Promise<Snapshot>;
	subscribe(listener: (snapshot: Snapshot) => void): () => void;
	accept(snapshot: Snapshot): Snapshot;
	clearCache(): void;
	waitForIdle(): Promise<void>;
}

export function selectNewestRevisionedSnapshot<Snapshot extends RevisionedSnapshot>(
	current: Snapshot | null,
	candidate: Snapshot,
): Snapshot {
	return current && current.revision >= candidate.revision ? current : candidate;
}

export async function applyRevisionedPatchWithRetry<
	Snapshot extends RevisionedSnapshot,
	Patch,
>(
	patch: Patch,
	transport: RevisionedSettingsTransport<Snapshot, Patch>,
): Promise<Snapshot> {
	let snapshot = await transport.getSnapshot();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await transport.sendPatch({ expectedRevision: snapshot.revision, patch });
		if (response.ok) return response.data;
		if (response.error.code !== 'revision_conflict' || attempt > 0) {
			throw new Error(`${response.error.code}: ${response.error.message}`);
		}
		snapshot = await transport.getSnapshot(true);
	}
	throw new Error('settings_unavailable: Settings patch retry exhausted');
}

export function createRevisionedSettingsClient<
	Snapshot extends RevisionedSnapshot,
	Patch,
>(
	transport: RevisionedSettingsTransport<Snapshot, Patch>,
	onListenerError: (error: unknown) => void = (error) => {
		console.error('[SPECTRA Settings] Snapshot subscriber failed:', error);
	},
): RevisionedSettingsClient<Snapshot, Patch> {
	let cachedSnapshot: Snapshot | null = null;
	let patchQueue: Promise<void> = Promise.resolve();
	const snapshotListeners = new Set<(snapshot: Snapshot) => void>();

	function publishSnapshot(candidate: Snapshot): Snapshot {
		const accepted = selectNewestRevisionedSnapshot(cachedSnapshot, candidate);
		if (accepted === cachedSnapshot) return accepted;
		cachedSnapshot = accepted;
		for (const listener of snapshotListeners) {
			try {
				listener(accepted);
			} catch (error) {
				onListenerError(error);
			}
		}
		return accepted;
	}

	function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const current = patchQueue.then(operation, operation);
		patchQueue = current.then(() => undefined, () => undefined);
		return current;
	}

	async function getSnapshot(forceRefresh = false): Promise<Snapshot> {
		if (cachedSnapshot && !forceRefresh) return cachedSnapshot;
		return publishSnapshot(await transport.getSnapshot(forceRefresh));
	}

	function patchSnapshot(patch: Patch): Promise<Snapshot> {
		return enqueue(async () => publishSnapshot(await applyRevisionedPatchWithRetry(patch, {
			getSnapshot,
			sendPatch: request => transport.sendPatch(request),
		})));
	}

	return {
		getSnapshot,
		patch: patchSnapshot,
		accept: publishSnapshot,
		subscribe(listener: (snapshot: Snapshot) => void): () => void {
			snapshotListeners.add(listener);
			if (cachedSnapshot) {
				try {
					listener(cachedSnapshot);
				} catch (error) {
					onListenerError(error);
				}
			}
			return () => snapshotListeners.delete(listener);
		},
		clearCache(): void {
			cachedSnapshot = null;
		},
		waitForIdle(): Promise<void> {
			return patchQueue;
		},
	};
}
