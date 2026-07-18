import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRemoteHostController } from '../src/offscreen-remote/remote-host';
import { getRemoteUrl } from '../src/remote/constants';
import { generateRemoteQR } from '../src/remote/qr-generator';
import { isSafeRemoteQrDataUrl } from '../src/remote/modal-renderer';
import {
	REMOTE_PAIRING_TTL_MS,
	createRemotePairing,
	createRemoteProof,
	isRemoteCommandMessage,
	verifyRemoteProof,
} from '../src/remote/protocol';

describe('remote protocol v2', () => {
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
			protocolVersion: 2,
			sessionId: pairing.sessionId,
			sequence: 1,
			generation: 0,
			command: 'volume_up',
		};
		expect(isRemoteCommandMessage(base)).toBe(true);
		expect(isRemoteCommandMessage({ ...base, command: 'run_javascript' })).toBe(false);
		expect(isRemoteCommandMessage({ ...base, sequence: 0 })).toBe(false);
		expect(isRemoteCommandMessage({ ...base, generation: -1 })).toBe(false);
	});
});

describe('authenticated remote host', () => {
	test('coalesces concurrent creates and cancels an in-flight create on tab close', async () => {
		const harness = createHarness();
		const first = harness.controller.createSession(11);
		const second = harness.controller.createSession(11);
		expect(second).toBe(first);

		harness.peer.emit('open', harness.peer.id);
		const [firstSession, secondSession] = await Promise.all([first, second]);
		expect(secondSession.sessionId).toBe(firstSession.sessionId);
		expect(harness.controller.describeSessions()).toHaveLength(1);

		const cancelHarness = createHarness();
		const pending = cancelHarness.controller.createSession(12);
		expect(await cancelHarness.controller.closeTab(12)).toBe(true);
		await expect(pending).rejects.toThrow('cancelled');
		cancelHarness.peer.emit('open', cancelHarness.peer.id);
		expect(cancelHarness.peer.destroyed).toBe(true);
		expect(cancelHarness.controller.describeSessions()).toEqual([]);
	});

	test('sends no state and executes no command before authentication', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(17);
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');

		connection.emit('data', {
			type: 'spectra.remote.command',
			protocolVersion: 2,
			sessionId: session.sessionId,
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
		harness.peer.emit('open', harness.peer.id);
		const session = await sessionPromise;
		const initialState = {
			generation: 4,
			volume: 110,
			volumeBase: 100,
			boost: 1.1,
			actualMode: 'webaudio' as const,
			phase: 'active' as const,
			volumeState: 'native' as const,
			muted: false,
			playing: true,
			speed: 1.25,
			tabTitle: 'Initial actual state',
			tabDomain: 'media.example',
		};
		expect(harness.controller.sendState(19, session.sessionId, initialState)).toBe(false);

		const connection = new FakeConnection();
		harness.peer.emit('connection', connection);
		connection.emit('open');
		expect(connection.sent.some((message) => message.type === 'spectra.remote.state')).toBe(false);
		const challenge = connection.sent.find((message) => message.type === 'spectra.remote.challenge');
		if (!challenge || typeof challenge.nonce !== 'string') throw new Error('Remote challenge was not sent');
		const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
		connection.emit('data', {
			type: 'spectra.remote.authenticate',
			protocolVersion: 2,
			sessionId: session.sessionId,
			proof,
		});
		await waitFor(() => connection.sent.some((message) => message.type === 'spectra.remote.state'));

		expect(connection.sent).toContainEqual({
			type: 'spectra.remote.state',
			protocolVersion: 2,
			sessionId: session.sessionId,
			...initialState,
		});
	});

	test('authenticates, binds commands to generation, and drops replayed commands', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(23);
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
			protocolVersion: 2,
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
			volume: 125,
			actualMode: 'capture',
			phase: 'active',
			muted: false,
			playing: true,
			speed: 1.25,
			tabTitle: 'Example',
			tabDomain: 'example.com',
		});
		expect(connection.sent.some((message) => message.type === 'spectra.remote.state' && message.generation === 7)).toBe(true);
		expect(harness.controller.getStatus(23)?.generation).toBe(7);

		const command = {
			type: 'spectra.remote.command',
			protocolVersion: 2,
			sessionId: session.sessionId,
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
	});

	test('destroys an active tab session and its peer through CLOSE_TAB semantics', async () => {
		const harness = createHarness();
		const sessionPromise = harness.controller.createSession(31);
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
			protocolVersion: 2,
			sessionId: session.sessionId,
			proof,
		});
		await waitFor(() => connection.sent.some(
			(message) => message.type === 'spectra.remote.auth-result' && message.ok,
		));

		expect(await harness.controller.closeSession(29, session.sessionId, 'manual')).toBe(true);
		expect(connection.sent).toContainEqual({
			type: 'spectra.remote.closed',
			protocolVersion: 2,
			sessionId: session.sessionId,
			reason: 'manual',
		});
		expect(connection.closed).toBe(true);
		expect(harness.peer.destroyed).toBe(true);
		expect(harness.controller.describeSessions()).toEqual([]);
	});
});

describe('remote-site supply chain and metadata privacy', () => {
	test('loads only local scripts and contains a restrictive deployment CSP', () => {
		const root = resolve(import.meta.dir, '../../../..', 'remote-site');
		const html = readFileSync(resolve(root, 'index.html'), 'utf8');
		const headers = readFileSync(resolve(root, '_headers'), 'utf8');
		const remoteApp = readFileSync(resolve(root, 'app.js'), 'utf8');
		const vendoredPeer = readFileSync(resolve(root, 'vendor/peerjs.min.js'));
		const installedPeer = readFileSync(resolve(import.meta.dir, '../node_modules/peerjs/dist/peerjs.min.js'));
		const extensionPackage = JSON.parse(readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'));
		const peerPackage = JSON.parse(readFileSync(resolve(import.meta.dir, '../node_modules/peerjs/package.json'), 'utf8'));
		expect(html).toContain('src="vendor/peerjs.min.js"');
		expect(html).not.toMatch(/unpkg|google\.com\/s2\/favicons|<script(?![^>]*\bsrc=)/iu);
		expect(headers).toContain("script-src 'self'");
		expect(headers).toContain("frame-ancestors 'none'");
		expect(createHash('sha256').update(vendoredPeer).digest('hex'))
			.toBe(createHash('sha256').update(installedPeer).digest('hex'));
		expect(extensionPackage.dependencies.peerjs).toBe(`^${peerPackage.version}`);
		expect(remoteApp).toMatch(/spectra-remote-v2\\n\$\{sessionId\}\\n\$\{nonce\}\\n\$\{PROTOCOL_VERSION\}/u);
		expect(remoteApp).toContain("data.type === 'spectra.remote.closed'");
		expect(remoteApp).toContain("element.toggleAttribute('inert', !visible)");
		expect(remoteApp).not.toContain("'Pairing host is unavailable' : 'Signaling connection failed', unavailable");
		expect(remoteApp).not.toMatch(/favicon|unpkg|google\.com\/s2/iu);
	});
});

function createHarness() {
	const runtimeMessages: Array<Record<string, unknown>> = [];
	const peer = new FakePeer('spectra-test');
	let timerId = 0;
	const controller = createRemoteHostController({
		createPeer: () => peer as never,
		sendRuntimeMessage: (message) => {
			runtimeMessages.push(message as Record<string, unknown>);
		},
		setTimer: () => ++timerId,
		clearTimer: () => undefined,
	});
	return { controller, peer, runtimeMessages };
}

class FakePeer {
	readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
	destroyed = false;
	constructor(readonly id: string) {}
	on(event: string, handler: (...args: any[]) => void): this {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
		return this;
	}
	emit(event: string, ...args: any[]): void {
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}
	destroy(): void { this.destroyed = true; }
}

class FakeConnection {
	readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
	readonly sent: Array<Record<string, any>> = [];
	open = true;
	closed = false;
	peer = 'controller-test';
	on(event: string, handler: (...args: any[]) => void): this {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
		return this;
	}
	emit(event: string, ...args: any[]): void {
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}
	send(message: Record<string, any>): void { this.sent.push(message); }
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
