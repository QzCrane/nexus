import { describe, expect, test } from 'bun:test';
import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
} from '@nexus/contracts';

function clone<T>(value: T): T {
	return structuredClone(value);
}

function validEmptyRequest(type: 'spectra.settings.get' | 'spectra.tab.visible.list') {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: `mutation-${type}`,
		type,
		payload: {},
	} as const;
}

function validRuntimeEnsure() {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: 'mutation-runtime-ensure',
		type: 'spectra.content.runtime.ensure',
		payload: {
			tabId: 42,
			documentId: 'document-42',
			reason: 'control',
			capability: 'mutation-test',
		},
		tabId: 42,
		documentId: 'document-42',
		generation: 3,
	} as const;
}

function validScreenshotCapture() {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: 'mutation-screenshot',
		type: 'spectra.screenshot.capture-visible',
		payload: {
			captureToken: 'capture-token-42',
			rect: {
				x: 10,
				y: 20,
				width: 640,
				height: 360,
				viewportWidth: 1280,
				viewportHeight: 720,
			},
		},
		tabId: 42,
		documentId: 'document-42',
		generation: 3,
	} as const;
}

describe('SPECTRA request-envelope structural mutations', () => {
	test('rejects deletion of every required envelope field across independent request families', () => {
		for (const baseline of [validEmptyRequest('spectra.settings.get'), validRuntimeEnsure(), validScreenshotCapture()]) {
			expect(isSpectraRequestEnvelope(baseline), baseline.type).toBe(true);
			for (const field of ['protocolVersion', 'requestId', 'type', 'payload'] as const) {
				const mutated = clone(baseline) as Record<string, unknown>;
				delete mutated[field];
				expect(isSpectraRequestEnvelope(mutated), `${baseline.type}:${field}`).toBe(false);
			}
		}
	});

	test('rejects unknown envelope/payload keys instead of silently widening the wire protocol', () => {
		for (const baseline of [validEmptyRequest('spectra.settings.get'), validRuntimeEnsure(), validScreenshotCapture()]) {
			const envelope = clone(baseline) as Record<string, unknown>;
			envelope.__unknownEnvelopeField = true;
			expect(isSpectraRequestEnvelope(envelope), `${baseline.type}:envelope`).toBe(false);

			const payload = clone(baseline) as unknown as { payload: Record<string, unknown> };
			payload.payload.__unknownPayloadField = true;
			expect(isSpectraRequestEnvelope(payload), `${baseline.type}:payload`).toBe(false);
		}
	});

	test('rejects every malformed optional context scalar', () => {
		const mutations: Array<[string, unknown]> = [
			['tabId', 0],
			['tabId', -1],
			['tabId', 1.5],
			['tabId', '42'],
			['documentId', ''],
			['documentId', 42],
			['generation', -1],
			['generation', 1.5],
			['generation', '3'],
		];
		for (const [field, value] of mutations) {
			const mutated = clone(validRuntimeEnsure()) as unknown as Record<string, unknown>;
			mutated[field] = value;
			expect(isSpectraRequestEnvelope(mutated), `${field}=${String(value)}`).toBe(false);
		}
	});

	test('rejects screenshot rectangle field deletion, unknown keys and non-finite/unsafe geometry', () => {
		for (const field of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'] as const) {
			const mutated = clone(validScreenshotCapture()) as unknown as {
				payload: { rect: Record<string, unknown> };
			};
			delete mutated.payload.rect[field];
			expect(isSpectraRequestEnvelope(mutated), `missing rect.${field}`).toBe(false);
		}

		const unknown = clone(validScreenshotCapture()) as unknown as {
			payload: { rect: Record<string, unknown> };
		};
		unknown.payload.rect.__unknownRectField = 1;
		expect(isSpectraRequestEnvelope(unknown)).toBe(false);

		for (const [field, value] of [
			['x', Number.NaN],
			['y', Number.POSITIVE_INFINITY],
			['width', 0],
			['height', -1],
			['viewportWidth', 0],
			['viewportHeight', -1],
		] as const) {
			const mutated = clone(validScreenshotCapture()) as unknown as {
				payload: { rect: Record<string, unknown> };
			};
			mutated.payload.rect[field] = value;
			expect(isSpectraRequestEnvelope(mutated), `rect.${field}=${String(value)}`).toBe(false);
		}
	});

	test('rejects protocol/type/request identity corruption regardless of payload family', () => {
		for (const baseline of [validEmptyRequest('spectra.tab.visible.list'), validRuntimeEnsure(), validScreenshotCapture()]) {
			for (const [field, value] of [
				['protocolVersion', SPECTRA_PROTOCOL_VERSION + 1],
				['requestId', ''],
				['requestId', 'x'.repeat(129)],
				['type', 'spectra.__unknown.request'],
				['payload', null],
			] as const) {
				const mutated = clone(baseline) as unknown as Record<string, unknown>;
				mutated[field] = value;
				expect(isSpectraRequestEnvelope(mutated), `${baseline.type}:${field}`).toBe(false);
			}
		}
	});
});
