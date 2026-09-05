import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	CAPTURE_ADMISSION_LIMIT,
	captureAdmissionTestApi,
	consumeCaptureAdmission,
	forgetCaptureAdmissionsForTab,
	isCaptureAdmissionFenceCurrent,
	mintCaptureAdmission,
	revokeCaptureAdmissionsForTab,
} from '../src/background/capture-admission';

function mint(now = 100) {
	return mintCaptureAdmission({
		kind: 'capture-start',
		operationId: crypto.randomUUID(),
		document: { tabId: 42, frameId: 0, documentId: 'document-42' },
		documentEpoch: 3,
		issuer: 'control-authority',
	}, now);
}

beforeEach(() => captureAdmissionTestApi.reset());

describe('Capture one-shot admission owner', () => {
	test('declares the temporary active-tab authority required by the exact target capture API', () => {
		const manifest = JSON.parse(readFileSync(
			resolve(import.meta.dir, '../public/manifest.json'),
			'utf8',
		)) as { permissions?: unknown };
		const captureOwner = readFileSync(
			resolve(import.meta.dir, '../src/background/handlers/capture.ts'),
			'utf8',
		);
		expect(manifest.permissions).toEqual(expect.arrayContaining(['activeTab', 'tabCapture']));
		expect(captureOwner).toContain('getMediaStreamId({ targetTabId: tabId }');
	});

	test('consumes an exact current-document grant once before physical work', () => {
		const admission = mint();
		const expected = { kind: 'capture-start', tabId: 42, documentId: 'document-42' } as const;
		expect(consumeCaptureAdmission(admission, expected, 101)).toEqual({
			ok: true,
			admission,
			fenceEpoch: 0,
		});
		expect(consumeCaptureAdmission(admission, expected, 102)).toEqual({
			ok: false,
			reason: 'Capture admission is unknown or already consumed',
		});
	});

	test('burns a known id on identity tampering and rejects expiry', () => {
		const tampered = mint();
		expect(consumeCaptureAdmission(
			{ ...tampered, documentEpoch: tampered.documentEpoch + 1 },
			{ kind: 'capture-start', tabId: 42, documentId: 'document-42' },
			101,
		)).toEqual({
			ok: false,
			reason: 'Capture admission does not match its authority record',
		});
		expect(consumeCaptureAdmission(
			tampered,
			{ kind: 'capture-start', tabId: 42, documentId: 'document-42' },
			102,
		).ok).toBe(false);

		const expired = mint(200);
		expect(consumeCaptureAdmission(
			expired,
			{ kind: 'capture-start', tabId: 42, documentId: 'document-42' },
			expired.expiresAtMonotonicMs,
		)).toEqual({ ok: false, reason: 'Capture admission expired' });
	});

	test('fails closed at capacity and revokes a whole document tab synchronously', () => {
		for (let index = 0; index < CAPTURE_ADMISSION_LIMIT; index += 1) mint(300);
		expect(captureAdmissionTestApi.count()).toBe(CAPTURE_ADMISSION_LIMIT);
		expect(() => mint(300)).toThrow('capacity is exhausted');
		revokeCaptureAdmissionsForTab(42);
		expect(captureAdmissionTestApi.count()).toBe(0);
	});

	test('invalidates an already-consumed ticket when the document lifecycle advances', () => {
		const admission = mint();
		const consumed = consumeCaptureAdmission(
			admission,
			{ kind: 'capture-start', tabId: 42, documentId: 'document-42' },
			101,
		);
		expect(consumed.ok).toBe(true);
		if (!consumed.ok) throw new Error(consumed.reason);
		expect(isCaptureAdmissionFenceCurrent(42, consumed.fenceEpoch)).toBe(true);
		revokeCaptureAdmissionsForTab(42);
		expect(isCaptureAdmissionFenceCurrent(42, consumed.fenceEpoch)).toBe(false);
		forgetCaptureAdmissionsForTab(42);
		expect(captureAdmissionTestApi.fenceCount()).toBe(0);
		expect(isCaptureAdmissionFenceCurrent(42, consumed.fenceEpoch)).toBe(false);
	});

	test('accepts resume grants only from the Capture session authority', () => {
		expect(() => mintCaptureAdmission({
			kind: 'capture-resume',
			operationId: 'resume-1',
			document: { tabId: 42, frameId: 0, documentId: 'document-42' },
			documentEpoch: 3,
			issuer: 'control-authority',
		}, 100)).toThrow('invalid issuer');
		const resume = mintCaptureAdmission({
			kind: 'capture-resume',
			operationId: 'resume-2',
			document: { tabId: 42, frameId: 0, documentId: 'document-42' },
			documentEpoch: 3,
			issuer: 'capture-session-authority',
		}, 100);
		expect(consumeCaptureAdmission(
			resume,
			{ kind: 'capture-resume', tabId: 42, documentId: 'document-42' },
			101,
		).ok).toBe(true);
	});
});
