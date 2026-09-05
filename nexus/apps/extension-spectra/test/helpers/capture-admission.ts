import type { CaptureAdmission } from '@nexus/contracts';

export function createCaptureAdmission(
	overrides: Partial<CaptureAdmission> = {},
): CaptureAdmission {
	const kind = overrides.kind ?? 'capture-start';
	return {
		id: 'capture-admission-fixture',
		kind,
		operationId: 'capture-operation-fixture',
		document: {
			tabId: 42,
			frameId: 0,
			documentId: 'document-42',
		},
		documentEpoch: 3,
		issuer: kind === 'capture-start'
			? 'control-authority'
			: 'capture-session-authority',
		workerEpoch: 'worker-epoch-fixture',
		expiresAtMonotonicMs: Number.MAX_SAFE_INTEGER,
		oneShot: true,
		...overrides,
	};
}
