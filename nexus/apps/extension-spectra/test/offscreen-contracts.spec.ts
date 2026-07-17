import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	DEFAULT_AUDIO_CONFIG,
	isOffscreenHostEvent,
	isOffscreenHostRequest,
	isOffscreenHostResponse,
	type OffscreenHostRequestType,
} from '@nexus/contracts';

const sessionId = 'A'.repeat(22);
const capability = 'B'.repeat(22);
const remoteSession = {
	protocolVersion: 2 as const,
	sessionId,
	peerId: `spectra-${'c'.repeat(32)}`,
	secret: 'D'.repeat(22),
	createdAt: 1_000,
	pairingExpiresAt: 301_000,
	tabId: 17,
	connected: false,
	capability,
	reconnectUntil: null,
	generation: 4,
};
const remoteState = {
	generation: 4,
	volume: 125,
	actualMode: 'bypass' as const,
	phase: 'idle' as const,
	muted: false,
	playing: true,
	speed: 1.25,
	tabTitle: 'Media',
	tabDomain: 'example.com',
};
const processorConfig = {
	boostGain: 1,
	compressor: false,
	mono: false,
	bass: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	pan: 0,
	delay: 0,
};

describe('offscreen host request contract', () => {
	test('has no legacy action table or generic kernel bypass', () => {
		const actions = readFileSync(
			resolve(import.meta.dir, '../../../packages/contracts/src/actions.ts'),
			'utf8',
		);
		const client = readFileSync(
			resolve(import.meta.dir, '../../../packages/nexus-kernel/src/messages/client.ts'),
			'utf8',
		);
		expect(actions).not.toContain('OFFSCREEN_ACTIONS');
		expect(client).not.toContain('sendToOffscreen');
	});

	test('accepts every canonical request type', () => {
		const requests: unknown[] = [
			{ target: 'offscreen', type: 'OFFSCREEN_HOST_HELLO' },
			{
				target: 'offscreen',
				type: 'OFFSCREEN_AUDIO_START',
				tabId: 17,
				streamId: 'stream-token',
				config: DEFAULT_AUDIO_CONFIG,
				generation: 1,
				controlRevision: 1,
			},
			{ target: 'offscreen', type: 'OFFSCREEN_AUDIO_STOP', tabId: 17, generation: 2 },
			{
				target: 'offscreen',
				type: 'OFFSCREEN_AUDIO_CANCEL_START',
				tabId: 17,
				generation: 2,
				stopCommitted: true,
			},
			{
				target: 'offscreen',
				type: 'OFFSCREEN_AUDIO_UPDATE',
				tabId: 17,
				generation: 3,
				controlRevision: 2,
				config: DEFAULT_AUDIO_CONFIG,
			},
			{ target: 'offscreen', type: 'OFFSCREEN_AUDIO_GET_VIZ', tabId: 17 },
			{ target: 'offscreen', type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH', tabIds: [17, 18] },
			{ target: 'offscreen', type: 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS', tabIds: [17, 18] },
			{ target: 'offscreen', type: 'REMOTE_HOST_CREATE_SESSION', tabId: 17 },
			{ target: 'offscreen', type: 'REMOTE_HOST_GET_STATUS', tabId: 17 },
			{ target: 'offscreen', type: 'REMOTE_HOST_DESCRIBE' },
			{ target: 'offscreen', type: 'REMOTE_HOST_CLOSE_SESSION', tabId: 17, sessionId },
			{ target: 'offscreen', type: 'REMOTE_HOST_CLOSE_TAB', tabId: 17 },
			{ target: 'offscreen', type: 'REMOTE_HOST_SEND_STATE', tabId: 17, sessionId, state: remoteState },
		];

		expect(requests.every(isOffscreenHostRequest)).toBe(true);
	});

	test('rejects invalid ids, generations, configs, tokens, state, and surplus input', () => {
		const validStart = {
			target: 'offscreen',
			type: 'OFFSCREEN_AUDIO_START',
			tabId: 17,
			streamId: 'stream-token',
			config: DEFAULT_AUDIO_CONFIG,
			generation: 1,
			controlRevision: 1,
		};
		const validState = {
			target: 'offscreen',
			type: 'REMOTE_HOST_SEND_STATE',
			tabId: 17,
			sessionId,
			state: remoteState,
		};

		expect(isOffscreenHostRequest({ ...validStart, tabId: 0 })).toBe(false);
		expect(isOffscreenHostRequest({ ...validStart, generation: -1 })).toBe(false);
		expect(isOffscreenHostRequest({
			...validStart,
			config: { ...DEFAULT_AUDIO_CONFIG, delay: -1 },
		})).toBe(false);
		expect(isOffscreenHostRequest({ ...validStart, unexpected: true })).toBe(false);
		expect(isOffscreenHostRequest({
			target: 'offscreen',
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: [17, 17],
		})).toBe(false);
		expect(isOffscreenHostRequest({ ...validState, sessionId: '123456' })).toBe(false);
		expect(isOffscreenHostRequest({
			...validState,
			state: { ...remoteState, volume: 801 },
		})).toBe(false);
	});
});

describe('offscreen host response and event contract', () => {
	test('validates responses according to their request type', () => {
		const responses: Array<[OffscreenHostRequestType, unknown]> = [
			['OFFSCREEN_HOST_HELLO', {
				audioTabs: [{ tabId: 17, generation: 4 }],
				remoteTabs: [{ tabId: 17, sessionId }],
			}],
			['OFFSCREEN_AUDIO_START', {
				ok: true,
				tabId: 17,
				generation: 4,
				controlRevision: 3,
				phase: 'active',
				contextState: 'running',
				graphSignature: 'bass:0|eq:-|compressor:0|mono:0|pan:0|delay:0',
				normalizedActualConfig: processorConfig,
			}],
			['OFFSCREEN_AUDIO_STOP', {
				ok: true,
				tabId: 17,
				generation: 5,
				controlRevision: 3,
				phase: 'idle',
				contextState: 'closed',
				graphSignature: 'none',
				normalizedActualConfig: null,
			}],
			['OFFSCREEN_AUDIO_CANCEL_START', {
				ok: false,
				tabId: 17,
				generation: 4,
				controlRevision: 3,
				error: { code: 'cancel_failed', message: 'Failed', retryable: true },
			}],
			['OFFSCREEN_AUDIO_UPDATE', {
				ok: true,
				tabId: 17,
				generation: 4,
				controlRevision: 4,
				phase: 'active',
				contextState: 'running',
				graphSignature: 'bass:0|eq:-|compressor:0|mono:0|pan:0|delay:0',
				normalizedActualConfig: processorConfig,
			}],
			['OFFSCREEN_AUDIO_GET_VIZ', { buffer: [0, 127, 255] }],
			['OFFSCREEN_AUDIO_GET_VIZ_BATCH', { frames: { 17: [0, 127, 255], 18: null } }],
			['OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS', { subscribedTabIds: [17, 18] }],
			['REMOTE_HOST_CREATE_SESSION', { success: true, session: remoteSession }],
			['REMOTE_HOST_GET_STATUS', { session: remoteSession }],
			['REMOTE_HOST_DESCRIBE', { sessions: [remoteSession] }],
			['REMOTE_HOST_CLOSE_SESSION', { success: true }],
			['REMOTE_HOST_CLOSE_TAB', { success: false, error: 'NOT_FOUND' }],
			['REMOTE_HOST_SEND_STATE', { success: true }],
		];

		for (const [type, response] of responses) {
			expect(isOffscreenHostResponse(type, response)).toBe(true);
		}
	});

	test('rejects malformed host responses before background state consumes them', () => {
		expect(isOffscreenHostResponse('OFFSCREEN_HOST_HELLO', {
			audioTabs: [],
			remoteTabs: [{ tabId: 17, sessionId: 'weak-token' }],
		})).toBe(false);
		expect(isOffscreenHostResponse('OFFSCREEN_AUDIO_START', {
			ok: true,
			tabId: 17,
			generation: -1,
			phase: 'active',
		})).toBe(false);
		expect(isOffscreenHostResponse('OFFSCREEN_AUDIO_GET_VIZ', { buffer: [256] })).toBe(false);
		expect(isOffscreenHostResponse('REMOTE_HOST_GET_STATUS', {
			session: { ...remoteSession, capability: 'weak-token' },
		})).toBe(false);
	});

	test('accepts typed lifecycle events and rejects forged command boundaries', () => {
		const events = [
			{ type: 'OFFSCREEN_AUDIO_ENDED', tabId: 17, generation: 4 },
			{
				type: 'REMOTE_HOST_EXECUTE_COMMAND',
				tabId: 17,
				sessionId,
				capability,
				sequence: 1,
				generation: 4,
				command: 'play_pause',
			},
			{ type: 'REMOTE_HOST_REQUEST_SYNC', tabId: 17, sessionId, capability },
			{ type: 'REMOTE_HOST_STATUS_CHANGE', tabId: 17, sessionId, capability, connected: true },
			{
				type: 'REMOTE_HOST_STATUS_CHANGE',
				tabId: 17,
				sessionId,
				capability,
				connected: false,
				reconnectUntil: 120_000,
			},
			{ type: 'REMOTE_HOST_SESSION_CLOSED', tabId: 17, sessionId, reason: 'manual' },
		];
		expect(events.every(isOffscreenHostEvent)).toBe(true);

		const command = events[1];
		expect(isOffscreenHostEvent({ ...command, sequence: 0 })).toBe(false);
		expect(isOffscreenHostEvent({ ...command, generation: -1 })).toBe(false);
		expect(isOffscreenHostEvent({ ...command, capability: 'weak-token' })).toBe(false);
		expect(isOffscreenHostEvent({ ...command, command: 'run_js' })).toBe(false);
		expect(isOffscreenHostEvent({
			type: 'REMOTE_HOST_STATUS_CHANGE',
			tabId: 17,
			sessionId,
			capability,
			connected: false,
		})).toBe(false);
	});
});
