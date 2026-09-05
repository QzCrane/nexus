// Authenticated PeerJS host for the unified SPECTRA offscreen document.
// The module intentionally does not register a runtime listener by itself: the
// unified offscreen entry owns that listener and delegates REMOTE_HOST_* calls.

import type { DataConnection, Peer } from './peerjs-loader';
import {
	isRemoteState,
	REMOTE_PENDING_CONNECTION_LIMIT,
	REMOTE_COMMAND_RECEIPT_LIMIT,
	type OffscreenHostResponse,
	type RemoteHostCloseReason,
	type RemoteHostEvent,
	type RemoteHostRequest,
	type RemoteHostRequestType,
	type RemoteHostSession,
} from '@nexus/contracts';
import {
	REMOTE_AUTH_TIMEOUT_MS,
	REMOTE_PROTOCOL_VERSION,
	REMOTE_RECONNECT_TTL_MS,
	createRemotePairing,
	generateRandomToken,
	isRemoteAuthenticateMessage,
	isRemoteCommandMessage,
	type RemotePairing,
	type RemoteState,
	verifyRemoteProof,
} from '../remote/protocol-core';

const LOG = '[SPECTRA Remote Host]';
const PEER_RECOVERY_BASE_DELAY_MS = 500;
const PEER_RECOVERY_MAX_DELAY_MS = 10_000;

function warn(...args: unknown[]): void {
	console.warn(LOG, ...args);
}

function safeClose(
	target: { close(): void } | null | undefined,
	onError: string | unknown[],
): void {
	if (!target) return;
	try {
		target.close();
	} catch (error) {
		if (Array.isArray(onError)) onError.push(error);
		else warn(onError, error);
	}
}

function emitSessionEvent(
	emit: (message: RemoteHostEvent) => void,
	session: HostSession,
	type: RemoteHostEvent['type'],
	fields: Record<string, unknown>,
): void {
	emit({
		type,
		tabId: session.tabId,
		sessionId: session.pairing.sessionId,
		capability: session.capability,
		sessionEpoch: session.sessionEpoch,
		...fields,
	} as RemoteHostEvent);
}

export type RemoteHostSessionStatus = RemoteHostSession;

export interface RemoteHostControllerDependencies {
	createPeer: (peerId: string) => Peer;
	ensurePeerRuntime: () => Promise<void>;
	sendRuntimeMessage?: (message: unknown) => unknown;
	now?: () => number;
	setTimer?: (callback: () => void, delayMs: number) => number;
	clearTimer?: (timerId: number) => void;
}

export interface RemoteHostController {
	handleRuntimeMessage(
		message: RemoteHostRequest,
		sendResponse: (response: OffscreenHostResponse<RemoteHostRequestType>) => void,
	): boolean;
	createSession(tabId: number): Promise<RemoteHostSessionStatus>;
	getStatus(tabId: number): RemoteHostSessionStatus | null;
	closeSession(tabId: number, sessionId: string, reason?: RemoteCloseReason): Promise<boolean>;
	closeTab(tabId: number): Promise<boolean>;
	sendState(tabId: number, sessionId: string, state: RemoteState): boolean;
	describeSessions(): RemoteHostSessionStatus[];
	destroy(): Promise<void>;
}

export type RemoteCloseReason = RemoteHostCloseReason;

interface HostSession {
	pairing: RemotePairing;
	capability: string;
	tabId: number;
	peer: Peer;
	connection: DataConnection | null;
	sessionEpoch: number;
	lastSequence: number;
	lastGeneration: number;
	lastState: RemoteState | null;
	reconnectUntil: number | null;
	expiryTimer: number | null;
	peerRecoveryTimer: number | null;
	peerRecoveryAttempts: number;
	commandReceipts: Set<string>;
	pendingConnections: Set<DataConnection>;
}

interface PendingSessionCreation {
	promise: Promise<RemoteHostSessionStatus>;
	pairing: RemotePairing;
	cancel(): void;
}

export function createRemoteHostController(
	dependencies: RemoteHostControllerDependencies,
): RemoteHostController {
	const createPeer = dependencies.createPeer;
	const ensurePeerRuntime = dependencies.ensurePeerRuntime;
	const sendRuntimeMessage = dependencies.sendRuntimeMessage ?? ((message: unknown) => chrome.runtime.sendMessage(message));
	const now = dependencies.now ?? Date.now;
	const setTimer = dependencies.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
	const clearTimer = dependencies.clearTimer ?? ((timerId) => window.clearTimeout(timerId));
	const sessions = new Map<number, HostSession>();
	const pendingCreations = new Map<number, PendingSessionCreation>();
	const closingSessionOperations = new Map<number, { sessionId: string; promise: Promise<boolean> }>();
	const closingTabs = new Set<number>();

	function emit(message: RemoteHostEvent): void {
		try {
			Promise.resolve(sendRuntimeMessage(message)).catch((error) => warn('Runtime message failed', error));
		} catch (error) {
			warn('Runtime message failed', error);
		}
	}

	function publicStatus(session: HostSession): RemoteHostSessionStatus {
		return {
			...session.pairing,
			tabId: session.tabId,
			connected: session.connection?.open === true,
			capability: session.capability,
			reconnectUntil: session.reconnectUntil,
			generation: session.lastGeneration,
			sessionEpoch: session.sessionEpoch,
			lastSequence: session.lastSequence,
		};
	}

	function isLiveSession(session: HostSession): boolean {
		return !closingTabs.has(session.tabId) && sessions.get(session.tabId) === session;
	}

	function effectiveAuthDeadline(session: HostSession): number {
		return session.sessionEpoch > 0
			? (session.reconnectUntil ?? now() + REMOTE_RECONNECT_TTL_MS)
			: session.pairing.pairingExpiresAt;
	}

	function canAuthenticate(session: HostSession): boolean {
		return now() <= effectiveAuthDeadline(session);
	}

	function scheduleExpiry(session: HostSession, deadline: number, reason: RemoteCloseReason): void {
		if (session.expiryTimer !== null) clearTimer(session.expiryTimer);
		const delay = Math.max(0, deadline - now());
		session.expiryTimer = setTimer(() => {
			const current = sessions.get(session.tabId);
			if (current !== session || current.connection !== null) return;
			void closeSession(session.tabId, session.pairing.sessionId, reason)
				.catch((error) => warn('Expiry close failed', error));
		}, delay);
	}

	function isCurrentSessionPeer(session: HostSession, peer: Peer): boolean {
		return isLiveSession(session) && session.peer === peer;
	}

	function clearPeerRecoveryTimer(session: HostSession): void {
		if (session.peerRecoveryTimer !== null) {
			clearTimer(session.peerRecoveryTimer);
			session.peerRecoveryTimer = null;
		}
	}

	function peerRecoveryDeadline(session: HostSession): number {
		return session.reconnectUntil
			?? (session.sessionEpoch > 0 ? now() + REMOTE_RECONNECT_TTL_MS : session.pairing.pairingExpiresAt);
	}

	function markConnectionDisconnected(session: HostSession, connection: DataConnection): void {
		if (session.connection !== connection) return;
		session.connection = null;
		session.reconnectUntil = now() + REMOTE_RECONNECT_TTL_MS;
		session.peerRecoveryAttempts = 0;
		scheduleExpiry(session, session.reconnectUntil, 'reconnect-expired');
		if ((session.peer as Peer & { open?: boolean }).open !== true) {
			schedulePeerRecovery(session);
		}
		emitSessionEvent(emit, session, 'REMOTE_HOST_STATUS_CHANGE', {
		connected: false,
		reconnectUntil: session.reconnectUntil,
	});
	}

	function schedulePeerRecovery(session: HostSession): void {
		if (!isLiveSession(session)) return;
		const deadline = peerRecoveryDeadline(session);
		const remaining = deadline - now();
		if (remaining <= 0) {
			const reason: RemoteCloseReason = session.sessionEpoch > 0
				? 'reconnect-expired'
				: 'pairing-expired';
			void closeSession(session.tabId, session.pairing.sessionId, reason)
				.catch((error) => warn('Peer recovery expiry close failed', error));
			return;
		}
		if (session.peerRecoveryTimer !== null) return;
		const delay = Math.min(
			remaining,
			Math.min(
				PEER_RECOVERY_MAX_DELAY_MS,
				PEER_RECOVERY_BASE_DELAY_MS * 2 ** Math.min(session.peerRecoveryAttempts, 5),
			),
		);
		session.peerRecoveryAttempts += 1;
		session.peerRecoveryTimer = setTimer(() => {
			session.peerRecoveryTimer = null;
			void recoverPeer(session).catch((error) => {
				warn('Peer recovery attempt failed', error);
				schedulePeerRecovery(session);
			});
		}, delay);
	}

	async function recoverPeer(session: HostSession): Promise<void> {
		if (!isLiveSession(session)) return;
		// Signaling ownership may be unavailable while an authenticated data
		// channel is still carrying commands/state. Preserve both logical owners;
		// retiring a PeerJS instance here would also tear down its data channels.
		if (session.connection?.open === true) {
			clearPeerRecoveryTimer(session);
			return;
		}
		if (now() >= peerRecoveryDeadline(session)) {
			schedulePeerRecovery(session);
			return;
		}
		const previousPeer = session.peer;
		// A delayed timer may race a late Peer "open" event. The open handler
		// normally clears the timer, but checking the vendor state here prevents
		// replacing a signaling owner that has already recovered. If replacement
		// is required, retire the old owner before creating the new one; otherwise
		// two PeerJS instances can remain live for the same peer id.
		if ((previousPeer as Peer & { open?: boolean }).open === true) {
			session.peerRecoveryAttempts = 0;
			return;
		}
		const connection = session.connection;
		if (connection) markConnectionDisconnected(session, connection);
		safeClose(connection, 'Stale Peer signaling owner could not close data connection');
		try {
			previousPeer.destroy();
		} catch (error) {
			warn('Stale Peer signaling owner could not be retired', error);
		}
		// destroy() can synchronously emit "close", whose handler may schedule a
		// follow-up recovery timer. That timer belongs to this replacement attempt
		// and must not race the new Peer creation.
		clearPeerRecoveryTimer(session);
		if (!isLiveSession(session) || session.peer !== previousPeer) {
			return;
		}
		let peer: Peer;
		try {
			peer = createPeer(session.pairing.peerId);
		} catch (error) {
			schedulePeerRecovery(session);
			throw error;
		}
		session.peer = peer;
		installPeerLifecycle(session, peer);
		if ((peer as Peer & { open?: boolean }).open !== true) schedulePeerRecovery(session);
	}

	function handlePeerDisconnected(session: HostSession, peer: Peer): void {
		if (!isCurrentSessionPeer(session, peer)) return;
		let reconnectSucceeded = true;
		try {
			peer.reconnect();
		} catch (error) {
			reconnectSucceeded = false;
			warn('Peer signaling reconnect failed', error);
		}
		if (!(session.connection?.open === true)
			|| !reconnectSucceeded) {
			schedulePeerRecovery(session);
		}
	}

	function handlePeerClosed(session: HostSession, peer: Peer): void {
		if (!isCurrentSessionPeer(session, peer)) return;
		// A terminal Peer close also retires the authenticated data channel. Mark
		// that transition before asking PeerJS to close it so a replacement Peer
		// cannot be blocked by a still-logically-current connection.
		const connection = session.connection;
		if (connection) markConnectionDisconnected(session, connection);
		safeClose(connection, 'Peer close could not close data connection');
		schedulePeerRecovery(session);
	}

	function installPeerLifecycle(
		session: HostSession,
		peer: Peer,
		isActive: () => boolean = () => isCurrentSessionPeer(session, peer),
		onOpen?: () => void,
		onFailure?: (error: Error) => void,
	): void {
		peer.on('open', () => {
			if (!isActive()) {
				try {
					peer.destroy();
				} catch (error) {
					warn('Stale Peer open callback could not retire transport', error);
				}
				return;
			}
			clearPeerRecoveryTimer(session);
			session.peerRecoveryAttempts = 0;
			onOpen?.();
		});
		peer.on('connection', (connection) => {
			if (isCurrentSessionPeer(session, peer)) acceptConnection(session, connection);
			else safeClose(connection, 'Stale data connection could not be closed');
		});
		peer.on('disconnected', () => {
			if (isCurrentSessionPeer(session, peer)) handlePeerDisconnected(session, peer);
			else onFailure?.(new Error('Peer signaling disconnected before session opened'));
		});
		peer.on('close', () => {
			if (isCurrentSessionPeer(session, peer)) handlePeerClosed(session, peer);
			else onFailure?.(new Error('Peer signaling closed before session opened'));
		});
		peer.on('error', (error) => {
			if (!isCurrentSessionPeer(session, peer)) {
				onFailure?.(new Error(`Peer signaling failed: ${error.type}`));
				return;
			}
			warn('Peer signaling error', error.type, error.message);
			if (!(session.connection?.open === true)
				|| (peer as Peer & { open?: boolean }).open !== true) {
				schedulePeerRecovery(session);
			}
		});
	}

	function rejectConnection(
		connection: DataConnection,
		sessionId: string,
		error: 'AUTH_FAILED' | 'EXPIRED' | 'ALREADY_CONNECTED' | 'INVALID_MESSAGE',
	): void {
		try {
			if (connection.open) {
				connection.send({
					type: 'spectra.remote.auth-result',
					protocolVersion: REMOTE_PROTOCOL_VERSION,
					sessionId,
					ok: false,
					error,
				});
			}
		} catch (sendError) {
			warn('Remote authentication rejection could not be sent', sendError);
		}
		safeClose(connection, 'Remote authentication rejection could not close transport');
	}

	function acceptConnection(session: HostSession, connection: DataConnection): void {
		if (session.pendingConnections.size >= REMOTE_PENDING_CONNECTION_LIMIT) {
			// Do not disclose whether another controller is authenticated. The local
			// cap is an admission guard for unauthenticated resource exhaustion.
			rejectConnection(connection, session.pairing.sessionId, 'AUTH_FAILED');
			return;
		}
		session.pendingConnections.add(connection);
		const nonce = generateRandomToken(32);
		let authenticated = false;
		let authenticating = false;
		let active = true;
		let authTimer: number | null = null;
		const reject = (
			error: 'AUTH_FAILED' | 'EXPIRED' | 'ALREADY_CONNECTED' | 'INVALID_MESSAGE',
		): void => {
			if (!active) return;
			active = false;
			session.pendingConnections.delete(connection);
			if (authTimer !== null) {
				clearTimer(authTimer);
				authTimer = null;
			}
			rejectConnection(connection, session.pairing.sessionId, error);
		};
		const isCurrentConnection = (): boolean => active
			&& isLiveSession(session);
		authTimer = setTimer(() => {
			if (active && !authenticated) reject('AUTH_FAILED');
		}, REMOTE_AUTH_TIMEOUT_MS);

		connection.on('open', () => {
			if (!isCurrentConnection()) return;
			if (session.connection?.open && session.connection !== connection) {
				reject('ALREADY_CONNECTED');
				return;
			}
			if (!canAuthenticate(session)) {
				reject('EXPIRED');
				return;
			}
			try {
				connection.send({
					type: 'spectra.remote.challenge',
					protocolVersion: REMOTE_PROTOCOL_VERSION,
					sessionId: session.pairing.sessionId,
					nonce,
					pairingExpiresAt: effectiveAuthDeadline(session),
				});
			} catch (error) {
				warn('Remote challenge could not be sent', error);
				reject('INVALID_MESSAGE');
			}
		});

		connection.on('data', (data: unknown) => {
			if (!isCurrentConnection()) return;
			if (!authenticated) {
				if (authenticating) return;
				if (!isRemoteAuthenticateMessage(data) || data.sessionId !== session.pairing.sessionId) {
					reject('INVALID_MESSAGE');
					return;
				}
				authenticating = true;
				void verifyRemoteProof(session.pairing.secret, session.pairing.sessionId, nonce, data.proof)
					.then((valid) => {
						// WebCrypto resolves after an arbitrary delay. Every part of the
						// connection tuple is revalidated before this result can mint an
						// epoch or become the session's current controller.
						if (!valid) {
							reject('AUTH_FAILED');
							return;
						}
						if (!isCurrentConnection() || !connection.open || !canAuthenticate(session)) {
							reject('EXPIRED');
							return;
						}
						if (session.connection !== null) {
							reject('ALREADY_CONNECTED');
							return;
						}
						if (session.sessionEpoch >= Number.MAX_SAFE_INTEGER) {
							reject('EXPIRED');
							return;
						}

						authenticated = true;
						session.pendingConnections.delete(connection);
						session.connection = connection;
						session.sessionEpoch += 1;
						session.lastSequence = 0;
						session.commandReceipts.clear();
						session.reconnectUntil = null;
						session.peerRecoveryAttempts = 0;
						clearPeerRecoveryTimer(session);
						if (session.expiryTimer !== null) {
							clearTimer(session.expiryTimer);
							session.expiryTimer = null;
						}
						if (authTimer !== null) {
							clearTimer(authTimer);
							authTimer = null;
						}

						try {
							connection.send({
								type: 'spectra.remote.auth-result',
								protocolVersion: REMOTE_PROTOCOL_VERSION,
								sessionId: session.pairing.sessionId,
								ok: true,
								sessionEpoch: session.sessionEpoch,
								reconnectUntil: now() + REMOTE_RECONNECT_TTL_MS,
							});
						} catch (error) {
							// Authentication has already become the logical owner. If the
							// final handshake frame cannot be delivered, roll that owner back
							// before any retry can claim the same session.
							warn('Remote authentication result could not be sent', error);
							markConnectionDisconnected(session, connection);
							safeClose(connection, 'Failed remote authentication connection could not be closed');
							return;
						}
						if (session.lastState) sendState(session.tabId, session.pairing.sessionId, session.lastState);
						if (session.connection !== connection
							|| !connection.open) return;
						emitSessionEvent(emit, session, 'REMOTE_HOST_STATUS_CHANGE', { connected: true });
						emitSessionEvent(emit, session, 'REMOTE_HOST_REQUEST_SYNC', {});
					})
					.catch((error) => {
						warn('Remote proof verification failed', error);
						if (active) reject('AUTH_FAILED');
					});
				return;
			}

			if (!connection.open || session.connection !== connection) return;
			if (!isRemoteCommandMessage(data)
				|| data.sessionId !== session.pairing.sessionId
				|| data.sessionEpoch !== session.sessionEpoch
				|| data.sequence <= session.lastSequence
				|| data.generation !== session.lastGeneration) {
				return;
			}
			if (session.commandReceipts.has(data.commandId)) return;

			session.lastSequence = data.sequence;
			session.commandReceipts.add(data.commandId);
			while (session.commandReceipts.size > REMOTE_COMMAND_RECEIPT_LIMIT) {
				const oldest = session.commandReceipts.values().next().value;
				if (oldest === undefined) break;
				session.commandReceipts.delete(oldest);
			}
			emitSessionEvent(emit, session, 'REMOTE_HOST_EXECUTE_COMMAND', {
			commandId: data.commandId,
			sequence: data.sequence,
			generation: data.generation,
			command: data.command,
		});
		});

		connection.on('close', () => {
			active = false;
			session.pendingConnections.delete(connection);
			if (authTimer !== null) {
				clearTimer(authTimer);
				authTimer = null;
			}
			if (!authenticated || session.connection !== connection || sessions.get(session.tabId) !== session) return;
			markConnectionDisconnected(session, connection);
		});

		connection.on('error', () => {
			if (!active) return;
			if (!authenticated) {
				reject('AUTH_FAILED');
				return;
			}
			if (session.connection !== connection) return;
			markConnectionDisconnected(session, connection);
			safeClose(connection, 'Failed data connection could not be closed');
		});
	}

	function createSession(tabId: number): Promise<RemoteHostSessionStatus> {
		if (!Number.isInteger(tabId) || tabId <= 0) return Promise.reject(new Error('Invalid tabId'));
		if (closingTabs.has(tabId)) return Promise.reject(new Error('SESSION_CLOSING'));
		const existing = sessions.get(tabId);
		if (existing) {
			return Promise.resolve(publicStatus(existing));
		}
		const pending = pendingCreations.get(tabId);
		if (pending) return pending.promise;

		const pairing = createRemotePairing(now());
		let capability = generateRandomToken(16);
		let creation!: PendingSessionCreation;
		const promise = new Promise<RemoteHostSessionStatus>((resolve, reject) => {
			let settled = false;
			let peer: Peer | null = null;
			let session: HostSession | null = null;
			let openTimer: number | null = null;
			const scrub = (): void => {
				pairing.secret = '';
				capability = '';
				if (session) session.capability = '';
			};
			const fail = (error: Error): void => {
				if (settled) return;
				settled = true;
				if (openTimer !== null) clearTimer(openTimer);
				peer?.destroy();
				scrub();
				reject(error);
			};
			creation = {
				promise: Promise.resolve(null as never),
				pairing,
				cancel() {
					fail(new Error('Remote session creation was cancelled'));
				},
			};

			const startPeer = (): void => {
				if (settled) return;
				try {
					peer = createPeer(pairing.peerId);
				} catch (error) {
					fail(error instanceof Error ? error : new Error(String(error)));
					return;
				}
				session = {
					pairing,
					capability,
					tabId,
					peer,
					connection: null,
					sessionEpoch: 0,
					lastSequence: 0,
					lastGeneration: 0,
					lastState: null,
					reconnectUntil: null,
					expiryTimer: null,
					peerRecoveryTimer: null,
					peerRecoveryAttempts: 0,
					commandReceipts: new Set(),
					pendingConnections: new Set(),
				};
				const currentPeer = peer;
				const currentSession = session;
				openTimer = setTimer(
					() => fail(new Error('Peer signaling connection timed out')),
					REMOTE_AUTH_TIMEOUT_MS,
				);
				installPeerLifecycle(
					currentSession,
					currentPeer,
					() => !closingTabs.has(tabId)
						&& currentSession.peer === currentPeer
						&& (pendingCreations.get(tabId) === creation || sessions.get(tabId) === currentSession),
					() => {
						if (settled || pendingCreations.get(tabId) !== creation) return;
						settled = true;
						if (openTimer !== null) clearTimer(openTimer);
						sessions.set(tabId, currentSession);
						scheduleExpiry(currentSession, pairing.pairingExpiresAt, 'pairing-expired');
						resolve(publicStatus(currentSession));
					},
					(error) => fail(error),
				);
			};
			void Promise.resolve()
				.then(ensurePeerRuntime)
				.then(startPeer)
				.catch((error) => fail(
					error instanceof Error ? error : new Error(String(error)),
				));
		});
		creation.promise = promise;
		pendingCreations.set(tabId, creation);
		void promise.finally(() => {
			if (pendingCreations.get(tabId) === creation) pendingCreations.delete(tabId);
		}).catch(() => undefined);
		return promise;
	}

	function getStatus(tabId: number): RemoteHostSessionStatus | null {
		if (closingTabs.has(tabId)) return null;
		const session = sessions.get(tabId);
		return session ? publicStatus(session) : null;
	}

	async function closeSessionOnce(tabId: number, sessionId: string, reason: RemoteCloseReason = 'manual'): Promise<boolean> {
		const session = sessions.get(tabId);
		if (!session || session.pairing.sessionId !== sessionId) return false;
		// Keep the closing tombstone observable to same-turn callers before any
		// transport teardown can complete synchronously in a test or vendor runtime.
		await Promise.resolve();
		if (sessions.get(tabId) !== session || !closingTabs.has(tabId)) return false;
		const connection = session.connection;
		const shouldNotify = connection?.open === true;
		const failures: unknown[] = [];
		clearPeerRecoveryTimer(session);
		if (session.expiryTimer !== null) {
			clearTimer(session.expiryTimer);
			session.expiryTimer = null;
		}
		// Retire logical ownership before closing the transport. PeerJS emits
		// `close` synchronously in some runtimes; leaving the connection current
		// would misclassify an explicit close as a reconnectable network loss.
		session.connection = null;
		session.reconnectUntil = null;
		if (shouldNotify) {
			try {
				connection.send({
					type: 'spectra.remote.closed',
					protocolVersion: REMOTE_PROTOCOL_VERSION,
					sessionId,
					sessionEpoch: session.sessionEpoch,
					reason,
				});
			} catch (error) {
				failures.push(error);
			}
		}
		safeClose(connection, failures);
		try {
			session.peer.destroy();
		} catch (error) {
			failures.push(error);
		}
		session.pairing.secret = '';
		session.capability = '';
		for (const pending of session.pendingConnections) {
			safeClose(pending, failures);
		}
		session.pendingConnections.clear();
		sessions.delete(tabId);
		emit({ type: 'REMOTE_HOST_SESSION_CLOSED', tabId, sessionId, reason });
		if (failures.length > 0) {
			warn('Session transport disposal failed', new AggregateError(failures));
		}
		return true;
	}

	function closeSession(tabId: number, sessionId: string, reason: RemoteCloseReason = 'manual'): Promise<boolean> {
		const pending = closingSessionOperations.get(tabId);
		if (pending) return pending.sessionId === sessionId
			? pending.promise
			: Promise.resolve(false);
		const pendingCreation = pendingCreations.get(tabId);
		if (!sessions.has(tabId) && pendingCreation) {
			if (pendingCreation.pairing.sessionId !== sessionId) return Promise.resolve(false);
			closingTabs.add(tabId);
			pendingCreation.cancel();
			const operation = pendingCreation.promise
				.then(() => true, () => true)
				.finally(() => {
					if (closingSessionOperations.get(tabId)?.promise === operation) {
						closingSessionOperations.delete(tabId);
					}
					if (!pendingCreations.has(tabId) && !sessions.has(tabId)) closingTabs.delete(tabId);
				});
			closingSessionOperations.set(tabId, { sessionId, promise: operation });
			return operation;
		}
		closingTabs.add(tabId);
		const operation = closeSessionOnce(tabId, sessionId, reason).finally(() => {
			if (closingSessionOperations.get(tabId)?.promise === operation) closingSessionOperations.delete(tabId);
			closingTabs.delete(tabId);
		});
		closingSessionOperations.set(tabId, { sessionId, promise: operation });
		return operation;
	}

	async function closeTab(tabId: number): Promise<boolean> {
		closingTabs.add(tabId);
		const pending = pendingCreations.get(tabId);
		if (pending) pending.cancel();
		const session = sessions.get(tabId);
		if (session) return closeSession(tabId, session.pairing.sessionId, 'tab-closed').finally(() => {
			if (!pendingCreations.has(tabId) && !sessions.has(tabId)) closingTabs.delete(tabId);
		});
		if (pending !== undefined) {
			return pending.promise.then(() => true, () => true).finally(() => {
				if (!pendingCreations.has(tabId) && !sessions.has(tabId)) closingTabs.delete(tabId);
			});
		}
		closingTabs.delete(tabId);
		return false;
	}

	function sendState(tabId: number, sessionId: string, state: RemoteState): boolean {
		const session = sessions.get(tabId);
		if (closingTabs.has(tabId)
			|| !session
			|| session.pairing.sessionId !== sessionId
			|| !isRemoteState(state)) return false;
		if (session.lastState && (
			state.generation < session.lastState.generation
			|| state.generation === session.lastState.generation
			&& state.revision < session.lastState.revision
		)) return false;
		session.lastState = state;
		session.lastGeneration = state.generation;
		const connection = session.connection;
		if (connection?.open) {
			try {
				connection.send({
					type: 'spectra.remote.state',
					protocolVersion: REMOTE_PROTOCOL_VERSION,
					sessionId,
					sessionEpoch: session.sessionEpoch,
					...state,
				});
			} catch (error) {
				// Keep the accepted projection cached; the next authenticated epoch
				// receives it during handshake. Closing the failed channel also drives
				// the bounded reconnect state machine.
				warn('Remote state delivery failed', error);
				markConnectionDisconnected(session, connection);
				safeClose(connection, 'Failed remote state connection could not be closed');
			}
		}
		// Success means the authoritative offscreen host accepted the state and
		// generation. An unauthenticated/disconnected controller receives this
		// exact cached state in its authenticated handshake; connection presence is
		// not the acceptance boundary.
		return true;
	}

	function describeSessions(): RemoteHostSessionStatus[] {
		return [...sessions.entries()]
			.filter(([tabId]) => !closingTabs.has(tabId))
			.map(([, session]) => publicStatus(session));
	}

	async function destroy(): Promise<void> {
		for (const pending of pendingCreations.values()) pending.cancel();
		await Promise.all([...sessions.values()].map((session) => (
			closeSession(session.tabId, session.pairing.sessionId, 'host-destroyed')
		)));
	}

	function handleRuntimeMessage(
		message: RemoteHostRequest,
		sendResponse: (response: OffscreenHostResponse<RemoteHostRequestType>) => void,
	): boolean {
		if (message.type === 'REMOTE_HOST_CREATE_SESSION') {
			void createSession(message.tabId)
				.then((session) => sendResponse({ success: true, session }))
				.catch((error) => sendResponse({ success: false, error: error instanceof Error ? error.message : 'CREATE_FAILED' }));
			return true;
		}
		if (message.type === 'REMOTE_HOST_GET_STATUS') {
			sendResponse({ session: getStatus(message.tabId) });
			return false;
		}
		if (message.type === 'REMOTE_HOST_DESCRIBE') {
			sendResponse({ sessions: describeSessions() });
			return false;
		}
		if (message.type === 'REMOTE_HOST_CLOSE_SESSION') {
			void closeSession(message.tabId, message.sessionId)
				.then((closed) => sendResponse({ success: closed, error: closed ? undefined : 'SESSION_MISMATCH' }));
			return true;
		}
		if (message.type === 'REMOTE_HOST_CLOSE_TAB') {
			void closeTab(message.tabId)
				.then((closed) => sendResponse({ success: closed }));
			return true;
		}
		if (message.type === 'REMOTE_HOST_SEND_STATE') {
			sendResponse({ success: sendState(message.tabId, message.sessionId, message.state) });
			return false;
		}
		return false;
	}

	return {
		handleRuntimeMessage,
		createSession,
		getStatus,
		closeSession,
		closeTab,
		sendState,
		describeSessions,
		destroy,
	};
}
