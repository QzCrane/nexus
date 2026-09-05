// goal: one bounded, fail-closed owner for physical Capture start capabilities

import {
	isCaptureAdmission,
	type CaptureAdmission,
	type CaptureAdmissionKind,
	type CaptureDocumentKey,
} from '@nexus/contracts';

export const CAPTURE_ADMISSION_TTL_MS = 15_000;
export const CAPTURE_ADMISSION_LIMIT = 128;

const workerEpoch = crypto.randomUUID();
interface CaptureAdmissionRecord {
	admission: CaptureAdmission;
	fenceEpoch: number;
}

const admissions = new Map<string, CaptureAdmissionRecord>();
const tabFenceEpochs = new Map<number, number>();

export interface CaptureAdmissionMintRequest {
	kind: CaptureAdmissionKind;
	operationId: string;
	document: CaptureDocumentKey;
	documentEpoch: number;
	issuer: CaptureAdmission['issuer'];
}

export interface CaptureAdmissionExpectation {
	kind: CaptureAdmissionKind;
	tabId: number;
	documentId: string;
}

export type CaptureAdmissionConsumption =
	| { ok: true; admission: CaptureAdmission; fenceEpoch: number }
	| { ok: false; reason: string };

function nowMonotonic(): number {
	return performance.now();
}

function purgeExpired(now: number): void {
	for (const [id, record] of admissions) {
		if (record.admission.expiresAtMonotonicMs <= now) admissions.delete(id);
	}
}

function issuerForKind(kind: CaptureAdmissionKind): CaptureAdmission['issuer'] {
	return kind === 'capture-start'
		? 'control-authority'
		: 'capture-session-authority';
}

export function mintCaptureAdmission(
	request: CaptureAdmissionMintRequest,
	now = nowMonotonic(),
): CaptureAdmission {
	purgeExpired(now);
	if (request.issuer !== issuerForKind(request.kind)) {
		throw new Error(`Capture ${request.kind} admission has an invalid issuer`);
	}
	if (admissions.size >= CAPTURE_ADMISSION_LIMIT) {
		throw new Error('Capture admission capacity is exhausted');
	}
	const tabFenceEpoch = tabFenceEpochs.get(request.document.tabId) ?? 0;
	if (!tabFenceEpochs.has(request.document.tabId)) {
		tabFenceEpochs.set(request.document.tabId, tabFenceEpoch);
	}
	const admission: CaptureAdmission = Object.freeze({
		id: crypto.randomUUID(),
		kind: request.kind,
		operationId: request.operationId,
		document: Object.freeze({ ...request.document }),
		documentEpoch: request.documentEpoch,
		issuer: request.issuer,
		workerEpoch,
		expiresAtMonotonicMs: now + CAPTURE_ADMISSION_TTL_MS,
		oneShot: true,
	});
	if (!isCaptureAdmission(admission)) {
		throw new Error('Capture authority attempted to mint an invalid admission');
	}
	admissions.set(admission.id, {
		admission,
		fenceEpoch: tabFenceEpoch,
	});
	return admission;
}

function matchesStored(
	candidate: CaptureAdmission,
	stored: CaptureAdmission,
): boolean {
	return candidate.id === stored.id
		&& candidate.kind === stored.kind
		&& candidate.operationId === stored.operationId
		&& candidate.document.tabId === stored.document.tabId
		&& candidate.document.frameId === stored.document.frameId
		&& candidate.document.documentId === stored.document.documentId
		&& candidate.documentEpoch === stored.documentEpoch
		&& candidate.issuer === stored.issuer
		&& candidate.workerEpoch === stored.workerEpoch
		&& candidate.expiresAtMonotonicMs === stored.expiresAtMonotonicMs
		&& candidate.oneShot === true;
}

// The known id is removed before any validation result is returned. A malformed
// or wrong-context attempt therefore cannot probe or reuse a real capability.
export function consumeCaptureAdmission(
	candidate: unknown,
	expectation: CaptureAdmissionExpectation,
	now = nowMonotonic(),
): CaptureAdmissionConsumption {
	if (!isCaptureAdmission(candidate)) {
		return { ok: false, reason: 'Capture admission is malformed' };
	}
	const record = admissions.get(candidate.id);
	if (!record) return { ok: false, reason: 'Capture admission is unknown or already consumed' };
	admissions.delete(candidate.id);
	const { admission: stored, fenceEpoch } = record;

	if (!matchesStored(candidate, stored)) {
		return { ok: false, reason: 'Capture admission does not match its authority record' };
	}
	if (stored.workerEpoch !== workerEpoch) {
		return { ok: false, reason: 'Capture admission belongs to a retired worker' };
	}
	if (stored.expiresAtMonotonicMs <= now) {
		return { ok: false, reason: 'Capture admission expired' };
	}
	if (stored.kind !== expectation.kind
		|| stored.document.tabId !== expectation.tabId
		|| stored.document.frameId !== 0
		|| stored.document.documentId !== expectation.documentId) {
		return { ok: false, reason: 'Capture admission belongs to another operation or document' };
	}
	if (!isCaptureAdmissionFenceCurrent(stored.document.tabId, fenceEpoch)) {
		return { ok: false, reason: 'Capture admission was revoked by document lifecycle' };
	}
	return { ok: true, admission: stored, fenceEpoch };
}

export function revokeCaptureAdmission(admission: CaptureAdmission | undefined): void {
	if (admission) admissions.delete(admission.id);
}

export function revokeCaptureAdmissionsForTab(tabId: number): void {
	tabFenceEpochs.set(tabId, (tabFenceEpochs.get(tabId) ?? 0) + 1);
	for (const [id, record] of admissions) {
		if (record.admission.document.tabId === tabId) admissions.delete(id);
	}
}

export function isCaptureAdmissionFenceCurrent(tabId: number, fenceEpoch: number): boolean {
	const current = tabFenceEpochs.get(tabId);
	return current !== undefined && current === fenceEpoch;
}

/**
 * Tab removal is terminal. Delete the fence as well as its grants so a stale
 * consumed admission cannot become valid again through the default epoch.
 */
export function forgetCaptureAdmissionsForTab(tabId: number): void {
	for (const [id, record] of admissions) {
		if (record.admission.document.tabId === tabId) admissions.delete(id);
	}
	tabFenceEpochs.delete(tabId);
}

export const captureAdmissionTestApi = {
	workerEpoch,
	count: () => admissions.size,
	fenceCount: () => tabFenceEpochs.size,
	reset(): void {
		admissions.clear();
		tabFenceEpochs.clear();
	},
};
