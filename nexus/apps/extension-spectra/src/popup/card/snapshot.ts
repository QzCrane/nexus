// goal: collect bounded document-fenced observations for a card without waking background runtime work
// inv: these are independent observations, not an atomic transaction; control generations/revisions remain authoritative

import { createSettlementPool, observeWithin } from '@nexus/kernel';
import type { AudioRuntimeStatus } from '@nexus/contracts';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/ui-spectra-client';
import { currentTopDocumentId, isCurrentTopDocument } from '../../shared/top-document';
import type { CardObservation, CardSnapshot } from './types';

export const CARD_SNAPSHOT_CONCURRENCY = 4;
const pendingReads = createSettlementPool<string, unknown>(CARD_SNAPSHOT_CONCURRENCY * 4);
const CARD_SNAPSHOT_TIMEOUT_MS = 5_000;

type ProcessorLifecycle = Pick<AudioRuntimeStatus, 'actualMode' | 'desiredMode' | 'phase' | 'generation'>;

// Independent reads can straddle one physical transition. A settled exact-
// document runtime read outranks an older session projection in both directions.
// Pending/error runtime phases never pretend to be the final processor state.
export function resolveInitialProcessorLifecycle(
	runtime: ProcessorLifecycle | null,
	session: ProcessorLifecycle | null,
): ProcessorLifecycle | null {
	const settled = runtime && (
		runtime.actualMode === 'bypass' && runtime.phase === 'idle'
		|| runtime.actualMode !== 'bypass' && runtime.phase === 'active'
	);
	return settled && (!session || runtime.generation >= session.generation) ? runtime : session;
}

export function hasKnownBackgroundRetentionInputs(snapshot: Pick<CardSnapshot, 'status' | 'isRemoteActive'>): boolean {
	return snapshot.status.state === 'known' && snapshot.isRemoteActive.state === 'known';
}

async function observeSource<T>(key: string, start: () => Promise<unknown>, project: (value: unknown) => T | null): Promise<CardObservation<T>> {
	const operation = pendingReads.getOrStart(key, start);
	if (!operation) return { state: 'unknown', reason: 'capacity' };
	try {
		const observed = await observeWithin(operation, CARD_SNAPSHOT_TIMEOUT_MS);
		if (!observed.settled) return { state: 'unknown', reason: 'timeout' };
		const value = project(observed.value);
		return value === null ? { state: 'unknown', reason: 'rejected' } : { state: 'known', value };
	} catch { return { state: 'unknown', reason: 'unavailable' }; }
}

async function collectCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;
	const key = `${tabId}:${documentId}`;
	const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
		observeSource(`${key}:runtime`, () => sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}, { documentId }),
			(value) => (value as Awaited<ReturnType<typeof sendSpectraTabRequest<'spectra.audio.runtime.get'>>>).ok
				? (value as { ok: true; data: import('@nexus/contracts').AudioRuntimeStatus }).data : null),
		observeSource(`${key}:control`, () => sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId, documentId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.control.snapshot.get'>>>;
				return response.ok && response.data?.documentId === documentId ? response.data : null;
			}),
		observeSource(`${key}:session`, () => sendSpectraRequest('spectra.audio.session.get', { tabId }, { tabId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.audio.session.get'>>>;
				return response.ok && (!response.data || response.data.documentId === documentId) ? { value: response.data } : null;
			}).then((result): CardObservation<import('@nexus/contracts').AudioSessionSnapshot | null> => (
				result.state === 'known' ? { state: 'known', value: result.value.value } : result
			)),
		observeSource(`${key}:remote`, () => sendSpectraRequest('spectra.remote.session.get', { tabId }, { tabId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.remote.session.get'>>>;
				return response.ok ? response.data.connected : null;
			}),
	]);
	if (!await isCurrentTopDocument(tabId, documentId)) return null;
	return { documentId, status, controlSnapshot, sessionSnapshot, isRemoteActive };
}

export async function readCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error('card snapshot requires a valid tab');
	return collectCardSnapshot(tabId);
}
