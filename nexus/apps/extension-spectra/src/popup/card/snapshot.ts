// goal: collect bounded document-fenced observations without waking passive background cards
// inv: these are independent observations, not an atomic transaction; control generations/revisions remain authoritative

import { createSettlementPool, observeWithin } from '@nexus/kernel';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/ui-spectra-client';
import { currentTopDocumentId, isCurrentTopDocument } from '../../shared/top-document';
import type { CardSnapshot } from './types';

export const CARD_SNAPSHOT_CONCURRENCY = 4;
const pendingReads = createSettlementPool<string, CardSnapshot | null>(CARD_SNAPSHOT_CONCURRENCY);
const CARD_SNAPSHOT_TIMEOUT_MS = 5_000;

async function collectCardSnapshot(tabId: number, passive: boolean): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;
	const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
		sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}, { documentId })
			.then((response) => response.ok ? response.data : null).catch(() => null),
		passive ? Promise.resolve(null) : sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId, documentId })
			.then((response) => response.ok && response.data?.documentId === documentId ? response.data : null).catch(() => null),
		sendSpectraRequest('spectra.audio.session.get', { tabId }, { tabId })
			.then((response) => response.ok && response.data?.documentId === documentId ? response.data : null).catch(() => null),
		sendSpectraRequest('spectra.remote.session.get', { tabId }, { tabId })
			.then((response) => response.ok ? response.data.connected : null).catch(() => null),
	]);
	if (!await isCurrentTopDocument(tabId, documentId)) return null;
	return { documentId, status, controlSnapshot, sessionSnapshot, isRemoteActive };
}

export async function readCardSnapshot(tabId: number, passive = false): Promise<CardSnapshot | null> {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error('card snapshot requires a valid tab');
	const pending = pendingReads.getOrStart(`${tabId}:${passive}`, () => collectCardSnapshot(tabId, passive));
	if (!pending) throw new Error('card snapshot capacity is occupied by unsettled reads');
	const observed = await observeWithin(pending, CARD_SNAPSHOT_TIMEOUT_MS);
	if (!observed.settled) throw new Error('card snapshot timed out');
	return observed.value;
}
