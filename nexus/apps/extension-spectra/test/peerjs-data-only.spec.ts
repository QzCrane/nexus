import { describe, expect, test } from 'bun:test';
import {
	DataConnection,
	PEER_MESSAGE_LIMIT_BYTES,
} from '../vendor/peerjs/peerjs.min.js';

describe('workspace-owned Remote PeerJS transport', () => {
	test('negotiates a JSON DataConnection and emits bounded messages', async () => {
		const peerConnection = new FakePeerConnection();
		installPeerConnection(peerConnection);
		const errors: Array<{ type: string }> = [];
		const received: unknown[] = [];
		const signaling: Array<Record<string, unknown>> = [];
		const provider = createProvider(peerConnection, signaling);
		const connection = new DataConnection('remote-peer', provider as never, {
			reliable: true,
			metadata: { protocolVersion: 3 },
		});
		connection.on('error', (error) => errors.push(error as { type: string }));
		connection.on('data', (data) => received.push(data));
		peerConnection.channel?.onopen?.();
		await Promise.resolve();
		await Promise.resolve();

		expect(signaling).toContainEqual(expect.objectContaining({
			type: 'OFFER',
			payload: expect.objectContaining({
				type: 'data',
				serialization: 'json',
			}),
		}));
		expect(connection.send({ ok: true })).toBe(true);
		expect(peerConnection.channel?.sent).toHaveLength(1);
		const encoded = new TextEncoder().encode(JSON.stringify({ accepted: true }));
		peerConnection.channel?.onmessage?.({ data: encoded.buffer } as MessageEvent);
		expect(received).toEqual([{ accepted: true }]);

		expect(connection.send({ value: 'x'.repeat(PEER_MESSAGE_LIMIT_BYTES) })).toBe(false);
		expect(peerConnection.channel?.sent).toHaveLength(1);
		expect(errors.at(-1)?.type).toBe('message-too-big');
		connection.close();
	});

	test('closes the DataConnection before parsing an oversized inbound frame', () => {
		const peerConnection = new FakePeerConnection();
		installPeerConnection(peerConnection);
		const errors: Array<{ type: string }> = [];
		const provider = createProvider(peerConnection, []);
		const connection = new DataConnection('remote-peer', provider as never, {});
		connection.on('error', (error) => errors.push(error as { type: string }));
		peerConnection.channel?.onopen?.();
		peerConnection.channel?.onmessage?.({
			data: new Uint8Array(PEER_MESSAGE_LIMIT_BYTES + 1),
		} as MessageEvent);

		expect(errors.at(-1)?.type).toBe('message-too-big');
		expect(connection.open).toBe(false);
		expect(connection.dataChannel).toBeNull();
	});
});

function installPeerConnection(peerConnection: FakePeerConnection): void {
	Object.defineProperty(globalThis, 'RTCPeerConnection', {
		configurable: true,
		value: class extends FakePeerConnection {
			constructor() {
				super();
				Object.assign(this, peerConnection);
			}
		},
	});
}

function createProvider(
	peerConnection: FakePeerConnection,
	signaling: Array<Record<string, unknown>>,
) {
	return {
		options: { config: {} },
		socket: { send: (message: Record<string, unknown>) => signaling.push(message) },
		emitError: () => undefined,
		getConnection: () => null,
		_removeConnection: () => undefined,
		peerConnection,
	};
}

class FakePeerConnection {
	readonly channel = new FakeDataChannel();
	readonly signalingState = 'stable';
	iceConnectionState = 'new';
	onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
	oniceconnectionstatechange: (() => void) | null = null;
	ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;

	createDataChannel(): FakeDataChannel {
		return this.channel;
	}

	async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
		return { type: 'offer', sdp: 'offer' };
	}

	async createAnswer(): Promise<{ type: 'answer'; sdp: string }> {
		return { type: 'answer', sdp: 'answer' };
	}

	async setLocalDescription(): Promise<void> {}

	async setRemoteDescription(): Promise<void> {}

	async addIceCandidate(): Promise<void> {}

	close(): void {
		this.iceConnectionState = 'closed';
	}
}

class FakeDataChannel {
	readonly sent: Uint8Array[] = [];
	bufferedAmount = 0;
	readyState = 'open';
	binaryType = 'arraybuffer';
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((error: unknown) => void) | null = null;

	send(data: ArrayBufferView): void {
		this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}

	close(): void {
		this.readyState = 'closed';
	}
}
