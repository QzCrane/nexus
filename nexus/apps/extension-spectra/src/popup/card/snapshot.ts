// goal: read one Popup card's document-bound runtime/control/session/remote facts in one transaction
// inv: a card snapshot never mixes two top-level document generations

import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/ui-spectra-client';
import { currentTopDocumentId, isCurrentTopDocument } from '../../shared/top-document';
import type { CardSnapshot } from './types';

export const CARD_SNAPSHOT_CONCURRENCY = 8;

export async function readCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;

	const runtimeStatusPromise = sendSpectraTabRequest(
		tabId,
		'spectra.audio.runtime.get',
		{},
		{ documentId },
	).then((result) => result.ok ? result.data : null).catch(() => null);
	const controlSnapshotPromise = sendSpectraRequest(
		'spectra.control.snapshot.get',
		{ tabId },
		{ tabId, documentId },
	).then((response) => {
		if (!response.ok) return null;
		const snapshot = response.data;
		return snapshot && snapshot.documentId !== documentId ? null : snapshot;
	}).catch(() => null);
	const sessionSnapshotPromise = sendSpectraRequest(
		'spectra.audio.session.get',
		{ tabId },
		{ tabId },
	).then((response) => response.ok ? response.data : null).catch(() => null);
	const remoteActivePromise = sendSpectraRequest(
		'spectra.remote.session.get',
		{ tabId },
		{ tabId },
	).then((response) => response.ok && response.data.connected).catch(() => false);

	const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
		runtimeStatusPromise,
		controlSnapshotPromise,
		sessionSnapshotPromise,
		remoteActivePromise,
	]);
	if (!await isCurrentTopDocument(tabId, documentId)) return null;
	return {
		documentId,
		status,
		controlSnapshot,
		sessionSnapshot,
		isRemoteActive,
	};
}

export async function readCardSnapshots(
	tabIds: readonly number[],
	concurrency = CARD_SNAPSHOT_CONCURRENCY,
): Promise<Map<number, CardSnapshot>> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
		throw new Error('card snapshot concurrency must be an integer from 1 through 32');
	}
	const uniqueTabIds = [...new Set(tabIds.filter((tabId) => Number.isSafeInteger(tabId) && tabId > 0))];
	const snapshots = new Map<number, CardSnapshot>();
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(concurrency, uniqueTabIds.length) }, async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			const tabId = uniqueTabIds[index];
			if (tabId === undefined) return;
			const snapshot = await readCardSnapshot(tabId);
			if (snapshot) snapshots.set(tabId, snapshot);
		}
	});
	await Promise.all(workers);
	return snapshots;
}
