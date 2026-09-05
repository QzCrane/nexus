import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	REMOTE_COMMAND_RECEIPT_LIMIT,
	REMOTE_PENDING_CONNECTION_LIMIT,
} from '@nexus/contracts';
import { createRemoteHostController } from '../src/offscreen-remote/remote-host';
import { getRemoteUrl } from '../src/remote/constants';
import { generateRemoteQR } from '../src/remote/qr-generator';
import { isSafeRemoteQrDataUrl } from '../src/remote/modal-renderer';
import {
	REMOTE_PAIRING_TTL_MS,
	REMOTE_RECONNECT_TTL_MS,
	createRemotePairing,
	createRemoteProof,
	isRemoteCommandMessage,
	verifyRemoteProof,
} from '../src/remote/protocol';

describe('remote protocol v3', () => {
	test('uses independent 128-bit tokens and puts the secret only in the URL fragment', () => {
		const pairing = createRemotePairing(1_000);
		expect(pairing.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(pairing.peerId).toMatch(/^spectra-[a-f0-9]{32}$/);
		expect(pairing.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(new Set([pairing.sessionId, pairing.peerId.slice(8), pairing.secret]).size).toBe(3);
		expect(pairing.pairingExpiresAt).toBe(1_000 + REMOTE_PAIRING_TTL_MS);

		const url = new URL(getRemoteUrl(pairing));
		expect(url.search).toBe('');
		expect(url.hash).toContain(`k=${pairing.secret}`);
		expect(url.href.split('#')[0]).not.toContain(pairing.secret);
	});

	test('rejects unsafe remote page base URLs', () => {
		const pairing = createRemotePairing();
		expect(() => getRemoteUrl(pairing, 'javascript:alert(1)')).toThrow();
		expect(() => getRemoteUrl(pairing, 'https://user:password@example.com')).toThrow();
		expect(new URL(getRemoteUrl(pairing, 'http://localhost:8788')).protocol).toBe('http:');
	});

	test('renders the exact fragment-secret pairing URL as a local SVG data URL', async () => {
		const pairing = createRemotePairing();
		const qr = await generateRemoteQR(pairing, 'https://remote.example.test');
		expect(qr).toStartWith('data:image/svg+xml;charset=utf-8,');
		const svg = decodeURIComponent(qr.slice(qr.indexOf(',') + 1));
		expect(svg).toContain('<svg');
		expect(svg).toContain('<path');
		// The secret is encoded into QR modules, never copied into a network URL or
		// metadata field in the generated image.
		expect(svg).not.toContain(pairing.secret);
		expect(isSafeRemoteQrDataUrl(qr)).toBe(true);
		expect(isSafeRemoteQrDataUrl('data:image/svg+xml;charset=utf-8,%3Csvg%20onload%3Dalert(1)%3E%3C%2Fsvg%3E')).toBe(false);
		expect(isSafeRemoteQrDataUrl('https://remote.example.test/qr.svg')).toBe(false);
	});

	test('loads the QR encoder only when a pairing surface requests it', () => {
		const remoteDirectory = resolve(import.meta.dir, '../src/remote');
		const bindings = readFileSync(resolve(remoteDirectory, 'ui-bindings.ts'), 'utf8');
		const entry = readFileSync(resolve(remoteDirectory, 'index.ts'), 'utf8');
		expect(bindings).not.toContain("import { generateRemoteQR } from './qr-generator.js'");
		expect(bindings).toContain("await import('./qr-generator.js')");
		expect(entry).not.toContain('export { generateRemoteQR }');
	});

	test('accepts only the correct HMAC proof', async () => {
		const pairing = createRemotePairing();
		const nonce = cryptoToken(32);
		const proof = await createRemoteProof(pairing.secret, pairing.sessionId, nonce);
		expect(await verifyRemoteProof(pairing.secret, pairing.sessionId, nonce, proof)).toBe(true);
		expect(await verifyRemoteProof(createRemotePairing().secret, pairing.sessionId, nonce, proof)).toBe(false);
	});

	test('rejects unknown commands, replay sequences, and negative generations at the boundary', () => {
		const pairing = createRemotePairing();
		const base = {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: pairing.sessionId,
			sessionEpoch: 1,
			commandId: 'E'.repeat(22),
			sequence: 1,
			generation: 0,
			command: 'volume_up',
		};
		expect(isRemoteCommandMessage(base)).toBe(true);
		expect(isRemoteCommandMessage({ ...base, command: 'run_javascript' })).toBe(false);
		expect(isRemoteCommandMessage({ ...base, sequence: 0 })).toBe(false);
		expect(isRemoteCommandMessage({ ...base, generation: -1 })).toBe(false);
		expect(isRemoteCommandMessage({
			...base,
			sequence: Number.MAX_SAFE_INTEGER,
			generation: Number.MAX_SAFE_INTEGER,
		})).toBe(true);
		expect(isRemoteCommandMessage({ ...base, sequence: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
		expect(isRemoteCommandMessage({ ...base, generation: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
	});
});

describe('authenticated remote host', () => {
	test('coalesces concurrent creates and cancels an in-flight create on tab close', async () => {
		const harness = createHarness();
		const first = harness.controller.createSession(11);
		const second = harness.controller.createSession(11);
		expect(second).toBe(first);

		await tick();
		harness.peer.emit('open', harness.peer.id);
		const [firstSession, secondSession] = await Promise.all([first, second]);
		expect(secondSession.sessionId).toBe(firstSession.sessionId);
		expect(harness.controller.describeSessions()).toHaveLength(1);

		const cancelHarness = createHarness();
		const pending = cancelHarness.controller.createSession(12);
		expect(await cancelHarness.controller.closeTab(12)).toBe(true);
		await expect(pending).rejects.toThrow('cancelled');
		expect(cancelHarness.peerCreations()).toBe(0);
		expect(cancelHarness.controller.describeSessions()).toEqual([]);
	});

	test('keeps a closing tombstone from returning a new session during host close', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(16);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;

		const close = harness.controller.closeSession(16, session.sessionId);
		await expect(harness.controller.createSession(16)).rejects.toThrow('SESSION_CLOSING');
		expect(await close).toBe(true);
		expect(harness.controller.getStatus(16)).toBeNull();
	});

	test('bounds unauthenticated connection resources before HMAC proof', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(18);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		await sessionPromise;

		const pending: FakeConnection[] = [];
		for (let index = 0; index < REMOTE_PENDING_CONNECTION_LIMIT; index += 1) {
			const connection = new FakeConnection();
			pending.push(connection);
			harness.peer.emit('connection', connection);
			connection.emit('open');
		}
		expect(pending.filter((connection) => connection.sent.some(
			(message) => message.type === 'spectra.remote.challenge',
		))).toHaveLength(REMOTE_PENDING_CONNECTION_LIMIT);

		const overflow = new FakeConnection();
		harness.peer.emit('connection', overflow);
		expect(overflow.closed).toBe(true);
		expect(overflow.sent).toContainEqual(expect.objectContaining({
			type: 'spectra.remote.auth-result',
			ok: false,
			error: 'AUTH_FAILED',
		}));
		await harness.controller.destroy();
	});

	test('loads the Peer runtime once before constructing a coalesced session', async () => {
		let releasePeerRuntime!: () => void;
		let ensureCalls = 0;
		let peerCreations = 0;
		const peer = new FakePeer('spectra-lazy');
		const controller = createRemoteHostController({
			ensurePeerRuntime: () => {
				ensureCalls += 1;
				return new Promise<void>((resolveRuntime) => {
					releasePeerRuntime = resolveRuntime;
				});
			},
			createPeer: () => {
				peerCreations += 1;
				return peer as never;
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const first = controller.createSession(13);
		const second = controller.createSession(13);
		expect(second).toBe(first);
		await waitFor(() => ensureCalls === 1);
		expect(peerCreations).toBe(0);

		releasePeerRuntime();
		await waitFor(() => peerCreations === 1);
		peer.emit('open', peer.id);
		await first;
	});

	test('cancels a vendor-waiting create and retries only after an explicit request', async () => {
		let releaseFirstRuntime!: () => void;
		let ensureCalls = 0;
		let peerCreations = 0;
		const peer = new FakePeer('spectra-retry');
		const controller = createRemoteHostController({
			ensurePeerRuntime: () => {
				ensureCalls += 1;
				if (ensureCalls === 1) {
					return new Promise<void>((resolveRuntime) => {
						releaseFirstRuntime = resolveRuntime;
					});
				}
				return Promise.resolve();
			},
			createPeer: () => {
				peerCreations += 1;
				return peer as never;
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const cancelled = controller.createSession(14);
		await waitFor(() => ensureCalls === 1);
		expect(await controller.closeTab(14)).toBe(true);
		await expect(cancelled).rejects.toThrow('cancelled');
		releaseFirstRuntime();
		await new Promise((resolveWait) => setTimeout(resolveWait, 0));
		expect(peerCreations).toBe(0);

		const retried = controller.createSession(14);
		await waitFor(() => peerCreations === 1);
		peer.emit('open', peer.id);
		await expect(retried).resolves.toMatchObject({ tabId: 14 });
		expect(ensureCalls).toBe(2);
	});

	test('clears a failed vendor wait so a later create can recover', async () => {
		let ensureCalls = 0;
		const peer = new FakePeer('spectra-recovered');
		const controller = createRemoteHostController({
			ensurePeerRuntime: () => {
				ensureCalls += 1;
				return ensureCalls === 1
					? Promise.reject(new Error('Peer vendor unavailable'))
					: Promise.resolve();
			},
			createPeer: () => peer as never,
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		await expect(controller.createSession(15)).rejects.toThrow('Peer vendor unavailable');
		expect(controller.describeSessions()).toEqual([]);
		const recovered = controller.createSession(15);
		await waitFor(() => ensureCalls === 2);
		peer.emit('open', peer.id);
		await expect(recovered).resolves.toMatchObject({ tabId: 15 });
	});

	test('sends no state and executes no command before authentication', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(17);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');

		connection.emit('data', {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 0,
			commandId: 'E'.repeat(22),
			sequence: 1,
			generation: 0,
			command: 'volume_up',
		});

		expect(connection.closed).toBe(true);
		expect(harness.runtimeMessages.some((message) => message.type === 'REMOTE_HOST_EXECUTE_COMMAND')).toBe(false);
		expect(connection.sent.some((message) => message.type === 'spectra.remote.state')).toBe(false);
	});

	test('caches initial actual state privately and sends it in the authenticated handshake', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(19);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const initialState = {
			generation: 4,
			revision: 1,
			volume: 110,
			volumeBase: 100,
			boost: 1.1,
			actualMode: 'bypass' as const,
			phase: 'active' as const,
			volumeState: 'native' as const,
			muted: false,
			playing: true,
			speed: 0.1,
			tabTitle: 'Initial actual state',
			tabDomain: 'media.example',
		};
		expect(harness.controller.sendState(19, session.sessionId, initialState)).toBe(true);
		expect(harness.controller.sendState(19, session.sessionId, {
			...initialState,
			revision: 0,
			volume: 10,
		})).toBe(false);

		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');
		expect(connection.sent.some((message) => message.type === 'spectra.remote.state')).toBe(false);
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!challenge || typeof challenge.nonce !== 'string') throw new Error('Remote challenge was not sent');
		const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof,
		});
		await waitFor(() => connection.sent.some((message) => message.type === 'spectra.remote.state'));

		expect(connection.sent).toContainEqual({
			type: 'spectra.remote.state',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 1,
			...initialState,
		});
	});

	test('authenticates, binds commands to generation, and drops replayed commands', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(23);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		expect(challenge).toBeDefined();

		const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof,
		});
		await waitFor(() => connection.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok,
		));

		expect(connection.sent.some((message) => message.type === 'spectra.remote.auth-result' && message.ok)).toBe(true);
		expect(harness.runtimeMessages.some((message) => message.type === 'REMOTE_HOST_REQUEST_SYNC')).toBe(true);

		harness.controller.sendState(23, session.sessionId, {
			generation: 7,
			revision: 2,
			volume: 125,
			volumeBase: 100,
			boost: 1.25,
			actualMode: 'capture',
			phase: 'active',
			volumeState: 'capture',
			muted: false,
			playing: true,
			speed: 1.25,
			tabTitle: 'Example',
			tabDomain: 'example.com',
		});
		expect(connection.sent.some((message) => message.type === 'spectra.remote.state' && message.generation === 7)).toBe(true);
		expect(connection.sent).toContainEqual(expect.objectContaining({
			type: 'spectra.remote.state',
			generation: 7,
			volume: 125,
			volumeBase: 100,
			boost: 1.25,
		}));
		expect(harness.controller.getStatus(23)?.generation).toBe(7);

		const command = {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 1,
			commandId: 'F'.repeat(22),
			sequence: 1,
			generation: 7,
			command: 'play_pause',
		};
		connection.emit('data', command);
		connection.emit('data', command);
		connection.emit('data', { ...command, sequence: 2, generation: 6 });

		const executions = harness.runtimeMessages.filter((message) => message.type === 'REMOTE_HOST_EXECUTE_COMMAND');
		expect(executions).toHaveLength(1);
		expect(executions[0]).toMatchObject({
			tabId: 23,
			sessionId: session.sessionId,
			capability: session.capability,
			sequence: 1,
			generation: 7,
			command: 'play_pause',
		});

		// The receipt ledger is deliberately bounded. After the 512-entry window
		// advances, the oldest opaque id is no longer retained and a later command
		// with that id can only be admitted because it carries a newer sequence.
		for (let sequence = 2; sequence <= REMOTE_COMMAND_RECEIPT_LIMIT + 1; sequence += 1) {
			connection.emit('data', {
				...command,
				commandId: String(sequence).padStart(22, '0'),
				sequence,
			});
		}
		connection.emit('data', {
			...command,
			sequence: REMOTE_COMMAND_RECEIPT_LIMIT + 2,
		});
		const boundedExecutions = harness.runtimeMessages.filter(
			(message) => message.type === 'REMOTE_HOST_EXECUTE_COMMAND',
		);
		expect(REMOTE_COMMAND_RECEIPT_LIMIT).toBe(512);
		expect(boundedExecutions).toHaveLength(REMOTE_COMMAND_RECEIPT_LIMIT + 2);
	});

	test('rotates the session epoch and resets sequence admission after reconnect', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(24);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;

		const primary = new FakeConnection();
		harness.peer.emit('connection', primary);
		primary.emit('open');
		const primaryChallenge = primary.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!primaryChallenge || typeof primaryChallenge.nonce !== 'string') {
			throw new Error('Primary remote challenge was not sent');
		}
		primary.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof: await createRemoteProof(session.secret, session.sessionId, primaryChallenge.nonce),
		});
		await waitFor(() => primary.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok === true,
		));
		harness.controller.sendState(24, session.sessionId, {
			generation: 7,
			revision: 1,
			volume: 100,
			volumeBase: 100,
			boost: 1,
			actualMode: 'capture',
			phase: 'active',
			volumeState: 'capture',
			muted: false,
			playing: true,
			speed: 1,
		});
		primary.emit('data', {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 1,
			commandId: 'A'.repeat(22),
			sequence: 1,
			generation: 7,
			command: 'play_pause',
		});

		primary.close();
		const replacement = new FakeConnection();
		harness.peer.emit('connection', replacement);
		replacement.emit('open');
		const replacementChallenge = replacement.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!replacementChallenge || typeof replacementChallenge.nonce !== 'string') {
			throw new Error('Replacement remote challenge was not sent');
		}
		replacement.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof: await createRemoteProof(session.secret, session.sessionId, replacementChallenge.nonce),
		});
		await waitFor(() => replacement.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok === true,
		));
		const replacementAuth = replacement.sent.find(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok === true,
		);
		expect(replacementAuth).toMatchObject({ sessionEpoch: 2 });

		// Sequence numbers are scoped to the authenticated epoch. The first
		// command in epoch 2 is therefore admitted at sequence 1, while a delayed
		// epoch-1 command cannot mutate the new authority.
		replacement.emit('data', {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 2,
			commandId: 'B'.repeat(22),
			sequence: 1,
			generation: 7,
			command: 'volume_up',
		});
		replacement.emit('data', {
			type: 'spectra.remote.command',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 1,
			commandId: 'C'.repeat(22),
			sequence: 2,
			generation: 7,
			command: 'volume_down',
		});

		const executions = harness.runtimeMessages.filter(
			(message) => message.type === 'REMOTE_HOST_EXECUTE_COMMAND',
		);
		expect(executions).toHaveLength(2);
		expect(executions.map((message) => [message.sessionEpoch, message.sequence, message.command]))
			.toEqual([[1, 1, 'play_pause'], [2, 1, 'volume_up']]);
	});

	test('retires a closed Peer before recovery and fences stale peer callbacks', async () => {
		const runtimeMessages: Array<Record<string, unknown>> = [];
		const peers: FakePeer[] = [];
		const timers = new Map<number, { callback: () => void; delayMs: number }>();
		let timerId = 0;
		const controller = createRemoteHostController({
			ensurePeerRuntime: () => Promise.resolve(),
			createPeer: () => {
				const peer = new FakePeer(`spectra-recovery-${peers.length}`);
				peers.push(peer);
				return peer as never;
			},
			sendRuntimeMessage: (message) => runtimeMessages.push(message as Record<string, unknown>),
			setTimer: (callback, delayMs) => {
				const id = ++timerId;
				timers.set(id, { callback, delayMs });
				return id;
			},
			clearTimer: (id) => { timers.delete(id); },
		});

		const session = await (async () => {
			const pending = controller.createSession(25);
			await waitFor(() => peers.length === 1);
			peers[0].emit('open', peers[0].id);
			return pending;
		})();
		const connection = new FakeConnection();
		peers[0].emit('connection', connection);
		connection.emit('open');
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!challenge || typeof challenge.nonce !== 'string') throw new Error('Recovery challenge was not sent');
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof: await createRemoteProof(session.secret, session.sessionId, challenge.nonce),
		});
		await waitFor(() => connection.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok === true,
		));

		peers[0].emit('disconnected');
		expect(peers[0].reconnectCalls).toBe(1);
		peers[0].emit('close');
		const recoveryTimer = [...timers.entries()].find(([, timer]) => timer.delayMs === 500);
		if (!recoveryTimer) throw new Error('Bounded Peer recovery timer was not scheduled');
		timers.delete(recoveryTimer[0]);
		recoveryTimer[1].callback();
		await waitFor(() => peers.length === 2);
		expect(peers[0].destroyed).toBe(true);
		const staleConnection = new FakeConnection();
		peers[0].emit('open', peers[0].id);
		peers[0].emit('connection', staleConnection);
		expect(staleConnection.closed).toBe(true);

		peers[1].emit('open', peers[1].id);
		expect(controller.getStatus(25)).toMatchObject({ sessionId: session.sessionId });
		expect(runtimeMessages.some((message) => message.type === 'REMOTE_HOST_STATUS_CHANGE'))
			.toBe(true);
		await controller.destroy();
	});

	test('does not authenticate a connection after its async proof transport closes', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(26);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!challenge || typeof challenge.nonce !== 'string') throw new Error('Stale-proof challenge was not sent');
		const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof,
		});
		// WebCrypto proof verification is asynchronous. Closing immediately after
		// dispatch must fence its eventual result and leave no authenticated owner.
		connection.close();
		await tick();
		expect(connection.sent.some((message) => message.type === 'spectra.remote.auth-result' && message.ok === true))
			.toBe(false);
		expect(harness.controller.getStatus(26)?.connected).toBe(false);
	});

	test('re-evaluates exclusivity when a queued peer opens at the reconnect deadline', async () => {
		let currentTime = 20_000;
		const harness = createHarness({ now: () => currentTime });
		const sessionPromise = harness.controller.createSession(37);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;

		const primary = new FakeConnection();
		harness.peer.emit('connection', primary);
		primary.emit('open');
		const primaryChallenge = primary.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!primaryChallenge || typeof primaryChallenge.nonce !== 'string') {
			throw new Error('Primary remote challenge was not sent');
		}
		const primaryProof = await createRemoteProof(session.secret, session.sessionId, primaryChallenge.nonce);
		primary.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof: primaryProof,
		});
		await waitFor(() => primary.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok,
		));

		// Both peers arrive while the primary is authenticated. A peer that opens
		// now is rejected, but a queued peer must be re-evaluated if the primary
		// disconnects before that queued transport reaches open.
		const queued = new FakeConnection();
		harness.peer.emit('connection', queued);
		const overlapping = new FakeConnection();
		harness.peer.emit('connection', overlapping);
		overlapping.emit('open');
		expect(overlapping.sent).toContainEqual({
			type: 'spectra.remote.auth-result',
			protocolVersion: 3,
			sessionId: session.sessionId,
			ok: false,
			error: 'ALREADY_CONNECTED',
		});
		expect(overlapping.closed).toBe(true);

		primary.close();
		const reconnectUntil = harness.controller.getStatus(37)?.reconnectUntil;
		expect(reconnectUntil).toBe(currentTime + REMOTE_RECONNECT_TTL_MS);
		if (reconnectUntil === null || reconnectUntil === undefined) {
			throw new Error('Reconnect deadline was not installed');
		}

		currentTime = reconnectUntil;
		queued.emit('open');
		const queuedChallenge = queued.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!queuedChallenge || typeof queuedChallenge.nonce !== 'string') {
			throw new Error('Queued remote challenge was not sent');
		}
		const queuedProof = await createRemoteProof(session.secret, session.sessionId, queuedChallenge.nonce);
		queued.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof: queuedProof,
		});
		await waitFor(() => queued.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok,
		));

		expect(harness.controller.getStatus(37)).toMatchObject({
			connected: true,
			reconnectUntil: null,
		});
		const statusChanges = harness.runtimeMessages.filter(
			(message) => message.type === 'REMOTE_HOST_STATUS_CHANGE',
		);
		expect(statusChanges.at(-2)).toMatchObject({
			tabId: 37,
			sessionId: session.sessionId,
			connected: false,
			reconnectUntil,
		});
		expect(statusChanges.at(-1)).toMatchObject({
			tabId: 37,
			sessionId: session.sessionId,
			connected: true,
		});
	});

	test('destroys an active tab session and its peer through CLOSE_TAB semantics', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(31);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		await sessionPromise;

		expect(await harness.controller.closeTab(31)).toBe(true);
		expect(harness.peer.destroyed).toBe(true);
		expect(harness.controller.getStatus(31)).toBeNull();
		expect(harness.controller.describeSessions()).toEqual([]);
	});

	test('notifies an authenticated controller before destroying a closed session', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(29);
		await tick();
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!challenge || typeof challenge.nonce !== 'string') throw new Error('Remote challenge was not sent');

		const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 3,
			sessionId: session.sessionId,
			proof,
		});
		await waitFor(() => connection.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok,
		));

		const disconnectedBeforeClose = harness.runtimeMessages.filter(
			(message) => message.type === 'REMOTE_HOST_STATUS_CHANGE'
				&& message.connected === false,
		).length;
		expect(await harness.controller.closeSession(29, session.sessionId, 'manual')).toBe(true);
		expect(connection.sent).toContainEqual({
			type: 'spectra.remote.closed',
			protocolVersion: 3,
			sessionId: session.sessionId,
			sessionEpoch: 1,
			reason: 'manual',
		});
		expect(connection.closed).toBe(true);
		expect(harness.peer.destroyed).toBe(true);
		expect(harness.controller.describeSessions()).toEqual([]);
		expect(harness.runtimeMessages.filter(
			(message) => message.type === 'REMOTE_HOST_STATUS_CHANGE'
				&& message.connected === false,
		)).toHaveLength(disconnectedBeforeClose);
	});
});

describe('remote-site supply chain and metadata privacy', () => {
	test('loads only local scripts and contains a restrictive deployment CSP', () => {
		const root = resolve(import.meta.dir, '../../../..', 'remote-site');
		const html = readFileSync(resolve(root, 'index.html'), 'utf8');
		const headers = readFileSync(resolve(root, '_headers'), 'utf8');
		const remoteApp = readFileSync(resolve(root, 'app.js'), 'utf8');
		const vendoredPeer = readFileSync(resolve(root, 'vendor/peerjs.min.js'), 'utf8');
		const vendoredPeerTypes = readFileSync(resolve(root, 'vendor/peerjs.min.d.ts'), 'utf8');
		const extensionVendor = readFileSync(resolve(import.meta.dir, '../src/offscreen-remote/peerjs-vendor.ts'), 'utf8');
		const peerLicense = readFileSync(resolve(root, 'vendor/LICENSE.peerjs'), 'utf8');
		const extensionPackage = JSON.parse(readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'));
		expect(html).not.toContain('src="vendor/peerjs.min.js"');
		expect(html).not.toMatch(/unpkg|google\.com\/s2\/favicons|<script(?![^>]*\bsrc=)/iu);
		expect(remoteApp).toContain("import('./vendor/peerjs.min.js')");
		expect(remoteApp).not.toMatch(/(?:globalThis|window)\.Peer\s*=/u);
		expect(headers).toContain("script-src 'self'");
		expect(headers).toContain("frame-ancestors 'none'");
		expect(extensionVendor).toContain("../../../../../remote-site/vendor/peerjs.min.js");
		expect(vendoredPeer).toContain('PeerJS 1.5.5');
		expect(vendoredPeer).toContain('PEER_MESSAGE_LIMIT_BYTES = 16 * 1024');
		expect(vendoredPeer).not.toMatch(/(?:globalThis|window)\.Peer\s*=/u);
		expect(vendoredPeer).not.toMatch(/\b(?:MediaConnection|BinaryPack|Raw)\s*(?:=|extends|class)\b/u);
		expect(vendoredPeerTypes).toContain('PEER_MESSAGE_LIMIT_BYTES');
		expect(vendoredPeerTypes).toContain('serialization?: \'json\'');
		expect(peerLicense).toContain('PeerJS 1.5.5');
		expect(extensionPackage.dependencies).not.toHaveProperty('peerjs');
		expect(extensionPackage.dependencies).not.toHaveProperty('uqr');
		expect(remoteApp).toMatch(/spectra-remote-v3\\n\$\{sessionId\}\\n\$\{nonce\}\\n\$\{PROTOCOL_VERSION\}/u);
		expect(remoteApp).toContain("data.type === 'spectra.remote.closed'");
		expect(remoteApp).toContain("element.toggleAttribute('inert', !visible)");
		expect(remoteApp).not.toContain("throw new AggregateError(failures, 'Remote transport disposal failed')");
		expect(remoteApp).toContain("console.error('Remote transport disposal failed'");
		expect(remoteApp).toContain("console.warn('Remote pairing persistence retry failed'");
		expect(remoteApp).toContain('const MAX_PAIRINGS = 16');
		expect(remoteApp).toContain('const MAX_PAIRING_STORAGE_BYTES = 64 * 1024');
		expect(remoteApp).not.toContain("'Pairing host is unavailable' : 'Signaling connection failed', unavailable");
		expect(remoteApp).not.toMatch(/favicon|unpkg|google\.com\/s2/iu);
	});
});

function createHarness(options: { now?: () => number } = {}) {
	const runtimeMessages: Array<Record<string, unknown>> = [];
	const peer = new FakePeer('spectra-test');
	let peerCreations = 0;
	let timerId = 0;
	const controller = createRemoteHostController({
		ensurePeerRuntime: () => Promise.resolve(),
		createPeer: () => {
			peerCreations += 1;
			return peer as never;
		},
		sendRuntimeMessage: (message) => {
			runtimeMessages.push(message as Record<string, unknown>);
		},
		now: options.now,
		setTimer: () => ++timerId,
		clearTimer: () => undefined,
	});
	return { controller, peer, peerCreations: () => peerCreations, runtimeMessages };
}

class FakePeer {
	readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	destroyed = false;
	open = false;
	reconnectCalls = 0;
	constructor(readonly id: string) {}
	on(event: string, handler: (...args: unknown[]) => void): this {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
		return this;
	}
	emit(event: string, ...args: unknown[]): void {
		if (event === 'open') this.open = true;
		if (event === 'close') this.open = false;
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}
	reconnect(): void { this.reconnectCalls += 1; }
	destroy(): void { this.destroyed = true; this.open = false; }
}

class FakeConnection {
	readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	readonly sent: Array<Record<string, unknown>> = [];
	open = true;
	closed = false;
	peer = 'controller-test';
	on(event: string, handler: (...args: unknown[]) => void): this {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
		return this;
	}
	emit(event: string, ...args: unknown[]): void {
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}
	send(message: Record<string, unknown>): void { this.sent.push(message); }
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.open = false;
		this.emit('close');
	}
}

function cryptoToken(byteLength: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function tick(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for remote host state');
		await tick();
	}
}
