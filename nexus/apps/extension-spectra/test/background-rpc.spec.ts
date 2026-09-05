import { describe, expect, test } from 'bun:test';
import {
	BACKGROUND_REQUEST_GUARDS,
	BACKGROUND_REQUEST_TYPES,
	isBackgroundRequestEnvelope,
	isBackgroundRequestType,
} from '../src/background/background-rpc';
import {
	DEFAULT_AUDIO_CONFIG,
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	type SpectraRequestType,
} from '@nexus/contracts';

function request<T extends SpectraRequestType>(
	type: T,
	payload: unknown,
	context: Record<string, unknown> = {},
) {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: 'background-rpc-test',
		type,
		payload,
		...context,
	};
}

const target = {
	frameId: 0,
	documentId: 'document-42',
	mediaId: 'media-1',
	sourceRevision: 1,
	kind: 'audio',
} as const;

describe('Background RPC ingress route parity', () => {
	test('derives one guard per registered route without duplicate routes', () => {
		expect(new Set(BACKGROUND_REQUEST_TYPES).size).toBe(BACKGROUND_REQUEST_TYPES.length);
		expect(Object.keys(BACKGROUND_REQUEST_GUARDS).sort()).toEqual(
			[...BACKGROUND_REQUEST_TYPES].sort(),
		);
		for (const type of BACKGROUND_REQUEST_TYPES) {
			expect(isBackgroundRequestType(type)).toBe(true);
			expect(typeof BACKGROUND_REQUEST_GUARDS[type]).toBe('function');
		}
	});

	test('accepts canonical Background routes and rejects content-only, response, and unknown messages', () => {
		const empty = request('spectra.content.runtime.status', {});
		expect(isBackgroundRequestEnvelope(empty)).toBe(true);
		expect(isSpectraRequestEnvelope(empty)).toBe(true);

		const contentOnly = request('spectra.media.state.get', {}, { tabId: 42 });
		expect(isBackgroundRequestType(contentOnly.type)).toBe(false);
		expect(isBackgroundRequestEnvelope(contentOnly)).toBe(false);

		const response = { ok: true, data: {} };
		expect(isBackgroundRequestEnvelope(response)).toBe(false);
		expect(isBackgroundRequestType('spectra.unknown.route')).toBe(false);
	});

	test('keeps exact canonical payload and context validation instead of accepting extra fields', () => {
		const revision = request('spectra.content.runtime.ready', { runtimeRevision: '1.2.3' });
		expect(isBackgroundRequestEnvelope(revision)).toBe(true);
		expect(isSpectraRequestEnvelope(revision)).toBe(true);
		expect(isBackgroundRequestEnvelope({
			...revision,
			payload: { runtimeRevision: '1.2.3', unexpected: true },
		})).toBe(false);

		const empty = request('spectra.settings.get', {});
		expect(isBackgroundRequestEnvelope({ ...empty, payload: { unexpected: true } })).toBe(false);

		const targetChanged = request(
			'spectra.content.target.changed',
			{ target },
			{ documentId: target.documentId },
		);
		expect(isBackgroundRequestEnvelope(targetChanged)).toBe(true);
		expect(isSpectraRequestEnvelope(targetChanged)).toBe(true);
		expect(isBackgroundRequestEnvelope({ ...targetChanged, documentId: 'stale-document' })).toBe(false);

		const audio = request('spectra.audio.config.set', { config: DEFAULT_AUDIO_CONFIG });
		expect(isBackgroundRequestEnvelope(audio)).toBe(true);
		expect(isBackgroundRequestEnvelope({
			...audio,
			payload: { config: DEFAULT_AUDIO_CONFIG, unexpected: true },
		})).toBe(false);

		const routeRecord = request('spectra.audio.route.record', { route: 'capture', force: true });
		expect(isBackgroundRequestEnvelope(routeRecord)).toBe(true);
		expect(isBackgroundRequestEnvelope({
			...routeRecord,
			payload: { domain: 'spoofed.example', route: 'capture', force: true },
		})).toBe(false);
	});

	test('preserves sender-bound special routes and their canonical guards', () => {
		const hotkey = request('spectra.content.default-hotkey.trigger', {
			action: SPECTRA_DEFAULT_HOTKEY_ACTIONS[0],
			phase: 'press',
			gesture: 'ArrowUp',
			repeated: false,
		});
		expect(isBackgroundRequestEnvelope(hotkey)).toBe(true);
		expect(isSpectraRequestEnvelope(hotkey)).toBe(true);
		expect(isBackgroundRequestEnvelope({ ...hotkey, tabId: 42 })).toBe(false);

		const remoteClose = request(
			'spectra.remote.session.close',
			{ tabId: 42, sessionId: 'A'.repeat(22) },
			{ tabId: 42 },
		);
		expect(isBackgroundRequestEnvelope(remoteClose)).toBe(true);
		expect(isSpectraRequestEnvelope(remoteClose)).toBe(true);
		expect(isBackgroundRequestEnvelope({
			...remoteClose,
			payload: { tabId: 42, sessionId: 'A'.repeat(22), extra: true },
		})).toBe(false);
		expect(isBackgroundRequestEnvelope({ ...remoteClose, tabId: 43 })).toBe(false);
	});
});
