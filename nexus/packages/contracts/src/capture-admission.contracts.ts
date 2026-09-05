// goal: strict, one-shot capabilities for starting a physical tab-capture owner

export const CAPTURE_ADMISSION_KINDS = ['capture-start', 'capture-resume'] as const;
export type CaptureAdmissionKind = (typeof CAPTURE_ADMISSION_KINDS)[number];

export interface CaptureDocumentKey {
	readonly tabId: number;
	readonly frameId: 0;
	readonly documentId: string;
}

export interface CaptureAdmission {
	readonly id: string;
	readonly kind: CaptureAdmissionKind;
	readonly operationId: string;
	readonly document: CaptureDocumentKey;
	readonly documentEpoch: number;
	readonly issuer: 'control-authority' | 'capture-session-authority';
	readonly workerEpoch: string;
	readonly expiresAtMonotonicMs: number;
	readonly oneShot: true;
}

const CAPTURE_ADMISSION_KEYS = new Set<keyof CaptureAdmission>([
	'id',
	'kind',
	'operationId',
	'document',
	'documentEpoch',
	'issuer',
	'workerEpoch',
	'expiresAtMonotonicMs',
	'oneShot',
]);
const CAPTURE_DOCUMENT_KEYS = new Set<keyof CaptureDocumentKey>([
	'tabId',
	'frameId',
	'documentId',
]);
const CAPTURE_ADMISSION_KIND_SET = new Set<string>(CAPTURE_ADMISSION_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= 0;
}

export function isCaptureDocumentKey(value: unknown): value is CaptureDocumentKey {
	return isRecord(value)
		&& hasOnlyKeys(value, CAPTURE_DOCUMENT_KEYS)
		&& Number.isSafeInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& value.frameId === 0
		&& isBoundedString(value.documentId, 256);
}

export function isCaptureAdmission(value: unknown): value is CaptureAdmission {
	return isRecord(value)
		&& hasOnlyKeys(value, CAPTURE_ADMISSION_KEYS)
		&& isBoundedString(value.id, 128)
		&& typeof value.kind === 'string'
		&& CAPTURE_ADMISSION_KIND_SET.has(value.kind)
		&& isBoundedString(value.operationId, 128)
		&& isCaptureDocumentKey(value.document)
		&& isSafeNonNegativeInteger(value.documentEpoch)
		&& ((value.kind === 'capture-start' && value.issuer === 'control-authority')
			|| (value.kind === 'capture-resume' && value.issuer === 'capture-session-authority'))
		&& isBoundedString(value.workerEpoch, 128)
		&& typeof value.expiresAtMonotonicMs === 'number'
		&& Number.isFinite(value.expiresAtMonotonicMs)
		&& value.expiresAtMonotonicMs >= 0
		&& value.oneShot === true;
}
