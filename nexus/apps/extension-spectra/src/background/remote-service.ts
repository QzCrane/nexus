// Background boundary for authenticated remote-control sessions. Offscreen
// lifecycle belongs exclusively to offscreen-coordinator.

import {
	REMOTE_COMMAND_PENDING_LIMIT,
	REMOTE_COMMAND_RECEIPT_LIMIT,
	REMOTE_COMMAND_TIMEOUT_MS,
	SPECTRA_PROTOCOL_VERSION,
	createSpectraEvent,
	isOffscreenHostEvent,
	type RemoteHostEvent,
	type RemoteHostSession,
	type RemoteState,
} from '@nexus/contracts';
import {
	acquireOffscreenLease,
	reconcileOffscreenHost,
	releaseOffscreenLease,
	sendOffscreenMessage,
	sendOffscreenMessageIfPresent,
} from './offscreen-coordinator';
import { executeCommand, setStateCallback, syncState } from './remote-commands';
import {
	ensureContentRuntime,
	releaseContentRuntimeLease,
} from './runtime-loader';
import { forEachBounded } from './bounded-fanout';
import {
	enqueueBoundedSerial,
	type BoundedSerialQueue,
} from '../remote/operation-queue';
import type { RemotePublicSession } from '../remote/protocol';
import { isPairingWindowExpired } from '../remote/pairing-window';
import { isTrustedExtensionUi } from './remote-sender-gate';
import {
	isBackgroundRequestEnvelope,
	rpcFailure,
	rpcSuccess,
RPC_INVALID_REQUEST} from './background-rpc';

const LOG = '[SPECTRA Remote BG]';
const REMOTE_HOST_GET_STATUS = 'REMOTE_HOST_GET_STATUS';

type HostSession = RemoteHostSession;

interface SessionAuthorization {
	session: HostSession;
	lastSequence: number;
	generation: number;
	valid: boolean;
	admittedCommandIds: Set<string>;
}

interface RemoteTabAuthority {
	tail: Promise<void>;
	closing: boolean;
	closeCompleted: boolean;
	closeSessionId: string | null;
	closePromise: Promise<{ success: boolean; error?: string }> | null;
}

interface RemoteObservationLease {
	documentId: string;
	capability: string;
	sessionId: string;
}

const authorizations = new Map<number, SessionAuthorization>();
const remoteObservationLeases = new Map<number, RemoteObservationLease>();
const sessionCreations = new Map<number, Promise<{ success: boolean; session?: RemotePublicSession; error?: string }>>();
const closingTabs = new Set<number>();
const remoteTabAuthorities = new Map<number, RemoteTabAuthority>();
const remoteSessionQueues = new Map<string, BoundedSerialQueue>();
const remoteCommandQueues = new Map<string, BoundedSerialQueue>();
let restorePromise: Promise<void> | null = null;
let restoreComplete = false;

function isAttemptedRemoteSessionMessage(message: unknown): boolean {
	if (!isRecord(message)) return false;
	return message.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& (message.type === 'spectra.remote.session.get'
			|| message.type === 'spectra.remote.session.create'
			|| message.type === 'spectra.remote.session.close');
}

function publishRemoteChanged(tabId: number, sessionId: string, connected: boolean): void {
	const event = createSpectraEvent(
		'spectra.remote.session.changed',
		{ tabId, sessionId, connected },
		{ tabId },
	);
	void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function publishRemoteClosed(tabId: number, sessionId: string): void {
	const event = createSpectraEvent('spectra.remote.session.closed', { tabId, sessionId }, { tabId });
	void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function sessionLeaseKey(sessionId: string): `remote:${string}` {
	return `remote:${sessionId}`;
}

function pendingLeaseKey(tabId: number): `remote:${string}` {
	return `remote:pending:${tabId}`;
}

function remoteTabAuthority(tabId: number): RemoteTabAuthority {
	const existing = remoteTabAuthorities.get(tabId);
	if (existing) return existing;
	const created: RemoteTabAuthority = {
		tail: Promise.resolve(),
		closing: false,
		closeCompleted: false,
		closeSessionId: null,
		closePromise: null,
	};
	remoteTabAuthorities.set(tabId, created);
	return created;
}

function enqueueRemoteTab<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
	const authority = remoteTabAuthority(tabId);
	const current = authority.tail.then(operation, operation);
	const tail = current.then(() => undefined, () => undefined);
	authority.tail = tail;
	void tail.finally(() => {
		if (remoteTabAuthorities.get(tabId) !== authority || authority.tail !== tail) return;
		// A completed close is a tombstone only while a queued lifecycle operation
		// still exists. Remove it after the tail drains so a closed tab cannot leave
		// one authority object and one Set entry per historical tab forever.
		if (authority.closing) {
			authority.closing = false;
			authority.closeCompleted = false;
			authority.closeSessionId = null;
			authority.closePromise = null;
			closingTabs.delete(tabId);
		}
		remoteTabAuthorities.delete(tabId);
	}).catch(() => undefined);
	return current;
}

function beginRemoteTabClose(tabId: number): RemoteTabAuthority {
	const authority = remoteTabAuthority(tabId);
	authority.closing = true;
	authority.closeCompleted = false;
	closingTabs.add(tabId);
	const known = authorizations.get(tabId);
	if (known) {
		known.valid = false;
		known.session.connected = false;
	}
	releaseRemoteObservation(tabId);
	return authority;
}

function completeRemoteTabClose(tabId: number, authority: RemoteTabAuthority): void {
	if (remoteTabAuthorities.get(tabId) !== authority) return;
	authority.closeCompleted = true;
}

function isRemoteTabClosing(authority: RemoteTabAuthority): boolean {
	return authority.closing && !authority.closeCompleted;
}

function rememberSession(session: HostSession): void {
	if (closingTabs.has(session.tabId)) {
		// A close admitted during restore still needs the recovered lease to send
		// its exact-id cleanup. Do not turn the tombstone into an unowned host by
		// releasing that lease while the close operation is pending.
		return;
	}
	const existing = authorizations.get(session.tabId);
	if (existing && existing.session.sessionId !== session.sessionId) {
		releaseOffscreenLease(sessionLeaseKey(existing.session.sessionId));
		releaseRemoteObservation(session.tabId);
	}
	if (existing
		&& existing.session.sessionId === session.sessionId
		&& session.sessionEpoch < existing.session.sessionEpoch) {
		// A delayed status from an older authenticated epoch must never roll the
		// Background authority backwards after a reconnect has been committed.
		return;
	}
	const sameEpoch = existing?.session.sessionId === session.sessionId
		&& existing.session.sessionEpoch === session.sessionEpoch;
	authorizations.set(session.tabId, {
		session,
		lastSequence: sameEpoch
			? Math.max(existing?.lastSequence ?? 0, session.lastSequence)
			: session.lastSequence,
		generation: existing?.session.sessionId === session.sessionId
			? Math.max(existing.generation, session.generation)
			: session.generation,
		valid: true,
		admittedCommandIds: sameEpoch ? new Set(existing?.admittedCommandIds) : new Set(),
	});
}

function releaseRemoteObservation(tabId: number): void {
	const lease = remoteObservationLeases.get(tabId);
	if (!lease) return;
	remoteObservationLeases.delete(tabId);
	releaseContentRuntimeLease(tabId, lease.documentId, 'remote', lease.capability);
}

function isCurrentRemoteSession(session: HostSession): boolean {
	const authorization = authorizations.get(session.tabId);
	return !closingTabs.has(session.tabId)
		&& authorization?.valid === true
		&& authorization.session.sessionId === session.sessionId
		&& authorization.session.sessionEpoch === session.sessionEpoch
		&& !isPairingWindowExpired(session, Date.now());
}

async function acquireRemoteObservation(
	session: HostSession,
	isCurrent: () => boolean = () => true,
): Promise<RemoteObservationLease> {
	const capability = `session:${session.sessionId}`;
	const ready = await ensureContentRuntime(session.tabId, undefined, 'remote', capability);
	if (!isCurrent()) {
		// The ensure call acquired a physical Content lease. Release that exact
		// lease when the remote session has been replaced/closed while awaiting it.
		releaseContentRuntimeLease(session.tabId, ready.documentId, 'remote', capability);
		throw new Error('REMOTE_OBSERVATION_STALE');
	}
	const previous = remoteObservationLeases.get(session.tabId);
	if (previous && (previous.documentId !== ready.documentId
		|| previous.capability !== capability
		|| previous.sessionId !== session.sessionId)) {
		releaseContentRuntimeLease(session.tabId, previous.documentId, 'remote', previous.capability);
	}
	const lease: RemoteObservationLease = {
		documentId: ready.documentId,
		capability,
		sessionId: session.sessionId,
	};
	remoteObservationLeases.set(session.tabId, lease);
	return lease;
}

function forgetSession(tabId: number): void {
	const known = authorizations.get(tabId);
	if (known) known.valid = false;
	authorizations.delete(tabId);
	if (known) releaseOffscreenLease(sessionLeaseKey(known.session.sessionId));
	releaseOffscreenLease(pendingLeaseKey(tabId));
	releaseRemoteObservation(tabId);
}

function toPublicSession(session: HostSession): RemotePublicSession {
	const {
		capability: _capability,
		reconnectUntil: _reconnectUntil,
		generation: _generation,
		sessionEpoch: _sessionEpoch,
		lastSequence: _lastSequence,
		...publicSession
	} = session;
	return publicSession;
}

async function restoreSessions(): Promise<void> {
	const snapshot = await reconcileOffscreenHost();
	// HELLO is authoritative. An empty snapshot, including the empty snapshot
	// inferred from a confirmed absent host, revokes every cached Background
	// authorization rather than leaving a stale QR/session available to UI.
	if (snapshot.remoteTabs.length === 0) {
		for (const tabId of [...authorizations.keys()]) forgetSession(tabId);
		return;
	}

	// Validate every status before mutating authorizations. This makes restore a
	// transaction: a mismatch in a later tab cannot leave an earlier tab adopted
	// from a partially trusted HELLO snapshot.
	const stagedSessions: HostSession[] = [];
	await forEachBounded(snapshot.remoteTabs, 4, async ({ tabId, sessionId }) => {
		const response = await sendOffscreenMessage({ type: REMOTE_HOST_GET_STATUS, tabId });
		if (!response.session
			|| response.session.tabId !== tabId
			|| response.session.sessionId !== sessionId) {
			throw new Error('Remote host status does not match its HELLO snapshot');
		}
		stagedSessions.push(response.session);
	});

	const stagedTabIds = new Set(stagedSessions.map((session) => session.tabId));
	const committed = new Map<number, { sessionId: string; sessionEpoch: number }>();
	try {
		// HELLO/status validation above is the transaction's read phase. Only now
		// revoke an authorization that the authoritative host no longer reports;
		// a failed read therefore cannot partially clear the old projection.
		for (const tabId of [...authorizations.keys()]) {
			if (!stagedTabIds.has(tabId)) forgetSession(tabId);
		}
		for (const session of stagedSessions) {
			if (closingTabs.has(session.tabId)) continue;
			rememberSession(session);
			committed.set(session.tabId, {
				sessionId: session.sessionId,
				sessionEpoch: session.sessionEpoch,
			});
		}
		// Seed the offscreen session with an actual projection only after all
		// identities have been validated. If a side effect fails, remove every
		// authorization committed by this attempt and retry from a clean boundary.
		await forEachBounded(stagedSessions, 4, async (session) => {
			if (closingTabs.has(session.tabId)) return;
			await syncState(session.tabId);
			if (session.connected) await acquireRemoteObservation(session, () => isCurrentRemoteSession(session));
		});
	} catch (error) {
		for (const [tabId, expected] of committed) {
			const current = authorizations.get(tabId);
			if (current?.session.sessionId === expected.sessionId
				&& current.session.sessionEpoch === expected.sessionEpoch) forgetSession(tabId);
		}
		throw error;
	}
}

// A failed restore is never converted into an empty-session success. The next
// UI operation or authenticated host event retries the authoritative handshake.
export function ensureRemoteSessionsRestored(): Promise<void> {
	if (restoreComplete) return Promise.resolve();
	if (restorePromise) return restorePromise;

	const attempt = restoreSessions().then(() => {
		restoreComplete = true;
	});
	restorePromise = attempt;
	void attempt.finally(() => {
		if (restorePromise === attempt) restorePromise = null;
	}).catch(() => undefined);
	return attempt;
}

function createSession(tabId: number): Promise<{ success: boolean; session?: RemotePublicSession; error?: string }> {
	const pending = sessionCreations.get(tabId);
	if (pending) return pending;
	const creation = enqueueRemoteTab(tabId, () => createSessionOnce(tabId));
	sessionCreations.set(tabId, creation);
	void creation.finally(() => {
		if (sessionCreations.get(tabId) === creation) sessionCreations.delete(tabId);
	}).catch(() => undefined);
	return creation;
}

async function createSessionOnce(tabId: number): Promise<{ success: boolean; session?: RemotePublicSession; error?: string }> {
	await ensureRemoteSessionsRestored();
	const authority = remoteTabAuthority(tabId);
	if (isRemoteTabClosing(authority)) {
		return { success: false, error: 'SESSION_CLOSING' };
	}
	if (authority.closing) {
		authority.closing = false;
		authority.closeCompleted = false;
		closingTabs.delete(tabId);
	}
	const existing = authorizations.get(tabId);
	if (existing?.valid === true) {
		const current = await readAuthoritativeSession(tabId, existing);
		if (current) {
			await syncState(tabId);
			if (current.connected) await acquireRemoteObservation(current, () => isCurrentRemoteSession(current)).catch(() => undefined);
			if (isRemoteTabClosing(authority)) return { success: false, error: 'SESSION_CLOSING' };
			return { success: true, session: toPublicSession(current) };
		}
	}
	if (existing) forgetSession(tabId);

	await assertControllableTab(tabId);
	if (isRemoteTabClosing(authority)) return { success: false, error: 'SESSION_CLOSING' };
	// Chrome can eventually reuse a numeric tab id. A successful controllability
	// check proves this is a new live tab, not the closed tab represented by the tombstone.
	closingTabs.delete(tabId);
	await acquireOffscreenLease(pendingLeaseKey(tabId));
	try {
		if (isRemoteTabClosing(authority)) {
			releaseOffscreenLease(pendingLeaseKey(tabId));
			return { success: false, error: 'SESSION_CLOSING' };
		}
		const response = await sendOffscreenMessage({
			type: 'REMOTE_HOST_CREATE_SESSION',
			tabId,
		});
		if (!response.success || !response.session) {
			forgetSession(tabId);
			return { success: false, error: response.error ?? 'CREATE_FAILED' };
		}
		await acquireOffscreenLease(sessionLeaseKey(response.session.sessionId));
		releaseOffscreenLease(pendingLeaseKey(tabId));
		if (isRemoteTabClosing(authority)) {
			// The close request was admitted while host creation was in flight.
			// Keep the exact host lease until the queued close consumes it; do not
			// expose a session already covered by the closing tombstone.
			return { success: false, error: 'SESSION_CLOSING' };
		}
		rememberSession(response.session);
		await syncState(tabId);
		if (isRemoteTabClosing(authority)) return { success: false, error: 'SESSION_CLOSING' };
		return { success: true, session: toPublicSession(response.session) };
	} catch (error) {
		forgetSession(tabId);
		return { success: false, error: error instanceof Error ? error.message : 'CREATE_FAILED' };
	}
}

async function readAuthoritativeSession(
	tabId: number,
	known?: SessionAuthorization,
): Promise<HostSession | null> {
	try {
		const response = await sendOffscreenMessage({
			type: REMOTE_HOST_GET_STATUS,
			tabId,
		});
		if (!response.session
			|| response.session.tabId !== tabId
			|| (known && response.session.sessionId !== known.session.sessionId)) {
			if (!known || authorizations.get(tabId) === known) forgetSession(tabId);
			return null;
		}
		rememberSession(response.session);
		return response.session;
	} catch {
		// A transport failure is not evidence that cached authority remains valid.
		// Clear it and fail closed; the next explicit create can establish a new
		// host lease and identity.
		if (!known || authorizations.get(tabId) === known) forgetSession(tabId);
		return null;
	}
}

async function getSessionOnce(tabId: number): Promise<{ session: RemotePublicSession | null; connected: boolean }> {
	await ensureRemoteSessionsRestored();
	const authority = remoteTabAuthority(tabId);
	if (isRemoteTabClosing(authority)) return { session: null, connected: false };
	const known = authorizations.get(tabId);
	if (!known) return { session: null, connected: false };
	if (!known.valid) return { session: null, connected: false };
	const session = await readAuthoritativeSession(tabId, known);
	if (!session) return { session: null, connected: false };
	if (isRemoteTabClosing(authority)) return { session: null, connected: false };
	if (isPairingWindowExpired(session, Date.now())) {
		// An unpaired session past its window must not stay available to the UI:
		// the dialog would keep presenting a QR code that can no longer pair.
		forgetSession(tabId);
		return { session: null, connected: false };
	}
	if (session.connected) await acquireRemoteObservation(session, () => isCurrentRemoteSession(session)).catch(() => undefined);
	if (isRemoteTabClosing(authority)) return { session: null, connected: false };
	return { session: toPublicSession(session), connected: session.connected };
}

function getSession(tabId: number): Promise<{ session: RemotePublicSession | null; connected: boolean }> {
	return enqueueRemoteTab(tabId, () => getSessionOnce(tabId));
}

async function closeSessionOnce(tabId: number, sessionId: string): Promise<{ success: boolean; error?: string }> {
	await ensureRemoteSessionsRestored();
	const known = authorizations.get(tabId);
	if (!known) {
		// A close can arrive during worker-start restore. The closing tombstone
		// intentionally prevents adopting the session into Background authority,
		// but the recovered offscreen lease still permits an exact-id cleanup.
		try {
			const response = await sendOffscreenMessageIfPresent({
				type: 'REMOTE_HOST_CLOSE_SESSION',
				tabId,
				sessionId,
			});
			if (!response || response.success || response.error === 'SESSION_MISMATCH') {
				releaseOffscreenLease(sessionLeaseKey(sessionId));
				forgetSession(tabId);
				return { success: true };
			}
			return response;
		} catch {
			return { success: false, error: 'SESSION_MISMATCH' };
		}
	}
	if (known.session.sessionId !== sessionId) return { success: false, error: 'SESSION_MISMATCH' };
	// Invalidate the ticket authority before awaiting the offscreen close ACK.
	// Any command already suspended in runtime acquisition will fail its fence
	// instead of executing against a session the user has just closed.
	known.valid = false;
	releaseRemoteObservation(tabId);
	try {
		const response = await sendOffscreenMessage({
			type: 'REMOTE_HOST_CLOSE_SESSION',
			tabId,
			sessionId,
		});
		if (!response.success && response.error !== 'SESSION_MISMATCH') return response;
		forgetSession(tabId);
		return { success: true };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : 'CLOSE_FAILED' };
	}
}

function closeSession(tabId: number, sessionId: string): Promise<{ success: boolean; error?: string }> {
	const known = authorizations.get(tabId);
	if (known && known.session.sessionId !== sessionId) {
		return Promise.resolve({ success: false, error: 'SESSION_MISMATCH' });
	}
	const currentAuthority = remoteTabAuthority(tabId);
	if (currentAuthority.closing && currentAuthority.closePromise) {
		return currentAuthority.closeSessionId === sessionId
			? currentAuthority.closePromise
			: Promise.resolve({ success: false, error: 'SESSION_MISMATCH' });
	}
	const authority = beginRemoteTabClose(tabId);
	authority.closeSessionId = sessionId;
	const operation = enqueueRemoteTab(tabId, async () => {
		try {
			return await closeSessionOnce(tabId, sessionId);
		} finally {
			completeRemoteTabClose(tabId, authority);
		}
	});
	authority.closePromise = operation;
	return operation;
}

async function sendStateToOffscreen(tabId: number, state: RemoteState): Promise<void> {
	const authorization = authorizations.get(tabId);
	if (authorization?.valid !== true) return;
	const response = await sendOffscreenMessage({
		type: 'REMOTE_HOST_SEND_STATE',
		tabId,
		sessionId: authorization.session.sessionId,
		state,
	});
	if (!response.success) throw new Error('Offscreen Remote host rejected the state delivery');
	const current = authorizations.get(tabId);
	if (current?.valid !== true
		|| current !== authorization
		|| current.session.sessionId !== authorization.session.sessionId
		|| current.session.sessionEpoch !== authorization.session.sessionEpoch) return;
	// This field is offscreen-accepted generation authority, not optimistic
	// local state. The host either sends it immediately or caches it for the
	// authenticated handshake. Awaiting this ACK also prevents a newly delivered
	// state from authorizing a client command before Background commits the same
	// generation after a worker restart.
	current.generation = Math.max(current.generation, state.generation);
}

type AuthorizedRemoteHostEvent = Extract<RemoteHostEvent, { capability: string }>;

async function authorizeHostEvent(message: AuthorizedRemoteHostEvent): Promise<SessionAuthorization | null> {
	const { tabId, sessionId, capability } = message;
	if (closingTabs.has(tabId)) return null;
	try {
		await ensureRemoteSessionsRestored();
	} catch {
		return null;
	}

	let authorization = authorizations.get(tabId);
	if (!authorization) {
		try {
			const response = await sendOffscreenMessage({ type: REMOTE_HOST_GET_STATUS, tabId });
			if (!response.session) return null;
			rememberSession(response.session);
			authorization = authorizations.get(tabId);
		} catch {
			return null;
		}
	}
	if (authorization?.valid !== true
		|| authorization.session.sessionId !== sessionId
		|| authorization.session.capability !== capability) return null;
	if (message.sessionEpoch < authorization.session.sessionEpoch) return null;
	if (message.sessionEpoch > authorization.session.sessionEpoch) {
		// A successful reauthentication rotates the epoch in Offscreen. Re-read
		// that authoritative status before adopting it; a delayed old event must
		// never reset the Background sequence gate.
		try {
			const response = await sendOffscreenMessage({ type: REMOTE_HOST_GET_STATUS, tabId });
			if (!response.session
				|| response.session.sessionId !== sessionId
				|| response.session.capability !== capability
				|| response.session.sessionEpoch !== message.sessionEpoch) return null;
			rememberSession(response.session);
			authorization = authorizations.get(tabId);
		} catch {
			return null;
		}
	}
	if (authorization?.valid !== true
		|| authorization.session.sessionId !== sessionId
		|| authorization.session.capability !== capability
		|| authorization.session.sessionEpoch !== message.sessionEpoch) return null;
	// Host work for an unpaired session past its window must be refused here.
	// Offscreen owns the same rule, but Background is the owner of the leases and
	// state projections this event drives, so it cannot inherit that decision.
	if (isPairingWindowExpired(authorization.session, Date.now())) return null;
	return authorization;
}

async function requireConnectedRemoteAuthorization(
	message: Extract<RemoteHostEvent, { type: 'REMOTE_HOST_EXECUTE_COMMAND' }>,
	authorization: SessionAuthorization,
): Promise<SessionAuthorization | null> {
	if (authorization.session.connected) return authorization;
	// Status and command events are separate Chrome messages. If a valid
	// command arrives before the corresponding connected status, refresh the
	// authoritative host once; if the status really was a disconnect, reject the
	// delayed command instead of executing it after the close fence.
	try {
		const response = await sendOffscreenMessage({
			type: REMOTE_HOST_GET_STATUS,
			tabId: message.tabId,
		});
		const session = response.session;
		if (session?.connected !== true
			|| session.sessionId !== message.sessionId
			|| session.capability !== message.capability
			|| session.sessionEpoch !== message.sessionEpoch) return null;
		rememberSession(session);
		const refreshed = authorizations.get(message.tabId);
		return refreshed?.valid === true
			&& refreshed.session.sessionId === message.sessionId
			&& refreshed.session.capability === message.capability
			&& refreshed.session.sessionEpoch === message.sessionEpoch
			&& refreshed.session.connected
			? refreshed
			: null;
	} catch {
		return null;
	}
}

interface RemoteCommandTicket {
	authorization: SessionAuthorization;
	tabId: number;
	sessionId: string;
	sessionEpoch: number;
	sequence: number;
	generation: number;
	commandId: string;
	cancelled: boolean;
}

function isCurrentRemoteCommandTicket(ticket: RemoteCommandTicket): boolean {
	const current = authorizations.get(ticket.tabId);
	return current === ticket.authorization
		&& current.valid
		&& current.session.sessionId === ticket.sessionId
		&& current.session.sessionEpoch === ticket.sessionEpoch
		&& current.session.connected
		&& current.lastSequence === ticket.sequence
		&& !ticket.cancelled;
}

function withRemoteTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number,
	onTimeout?: () => void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				onTimeout?.();
			} catch (error) {
				console.warn(LOG, 'Remote command timeout cancellation failed', error);
			}
			reject(new Error('REMOTE_COMMAND_TIMEOUT'));
		}, timeoutMs);
		operation.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function handleHostCommand(
	message: Extract<RemoteHostEvent, { type: 'REMOTE_HOST_EXECUTE_COMMAND' }>,
): Promise<void> {
	let authorization = await authorizeHostEvent(message);
	if (!authorization) return;
	authorization = await requireConnectedRemoteAuthorization(message, authorization);
	if (!authorization) return;
	if (message.sequence <= authorization.lastSequence
		|| message.generation !== authorization.generation
		|| authorization.admittedCommandIds.has(message.commandId)) {
		await syncState(authorization.session.tabId).catch(() => undefined);
		return;
	}
	// Admission is serialized with observation acquisition. The sequence is
	// consumed before the first await, so a duplicate cannot overtake a pending
	// command and the physical operation is never run by an older epoch.
	authorization.lastSequence = message.sequence;
	authorization.admittedCommandIds.add(message.commandId);
	while (authorization.admittedCommandIds.size > REMOTE_COMMAND_RECEIPT_LIMIT) {
		const oldest = authorization.admittedCommandIds.values().next().value;
		if (oldest === undefined) break;
		authorization.admittedCommandIds.delete(oldest);
	}
	const ticket: RemoteCommandTicket = {
		authorization,
		tabId: authorization.session.tabId,
		sessionId: authorization.session.sessionId,
		sessionEpoch: authorization.session.sessionEpoch,
		sequence: message.sequence,
		generation: message.generation,
		commandId: message.commandId,
		cancelled: false,
	};
	const abortController = new AbortController();
	const operation = (async () => {
		await acquireRemoteObservation(
			authorization.session,
			() => isCurrentRemoteCommandTicket(ticket),
		);
		if (!isCurrentRemoteCommandTicket(ticket)) return;
		await executeCommand(message.command, authorization.session.tabId, undefined, abortController.signal);
		// Execution is an external await. Do not publish/continue any old result
		// after close, epoch rotation, document replacement, worker restore, or
		// command timeout.
		if (!isCurrentRemoteCommandTicket(ticket)) return;
	})();
	try {
		await withRemoteTimeout(operation, REMOTE_COMMAND_TIMEOUT_MS, () => {
			ticket.cancelled = true;
			abortController.abort('REMOTE_COMMAND_TIMEOUT');
		});
	} catch {
		if (isCurrentRemoteCommandTicket(ticket)) {
			await syncState(authorization.session.tabId).catch(() => undefined);
		}
	}
}

async function handleHostSync(
	message: Extract<RemoteHostEvent, { type: 'REMOTE_HOST_REQUEST_SYNC' }>,
): Promise<void> {
	const authorization = await authorizeHostEvent(message);
	if (authorization) {
		const session = authorization.session;
		await acquireRemoteObservation(session, () => {
			const current = authorizations.get(session.tabId);
			return current === authorization && current.valid
				&& current.session.sessionEpoch === message.sessionEpoch;
		}).catch(() => undefined);
		if (authorizations.get(session.tabId) === authorization && authorization.valid) {
			await syncState(session.tabId);
		}
	}
}

function fenceDisconnectedHostEvent(
	message: Extract<RemoteHostEvent, { type: 'REMOTE_HOST_STATUS_CHANGE' }>,
): void {
	if (message.connected) return;
	const authorization = authorizations.get(message.tabId);
	if (!authorization
		|| authorization.session.sessionId !== message.sessionId
		|| authorization.session.capability !== message.capability
		|| message.sessionEpoch < authorization.session.sessionEpoch) return;
	// This is intentionally synchronous and happens before any event queue. A
	// network close is a revocation edge, not ordinary state publication; every
	// already-admitted command must fail its ticket even if its operation is
	// waiting on Content/Chrome I/O.
	authorization.session.connected = false;
	releaseRemoteObservation(message.tabId);
}

async function handleHostStatusChange(
	message: Extract<RemoteHostEvent, { type: 'REMOTE_HOST_STATUS_CHANGE' }>,
): Promise<void> {
	const authorization = await authorizeHostEvent(message);
	if (!authorization) return;
	const session = authorization.session;
	session.connected = message.connected;
	if (message.connected) {
		await acquireRemoteObservation(session, () => {
			const current = authorizations.get(session.tabId);
			return current === authorization && current.valid
				&& current.session.sessionEpoch === message.sessionEpoch;
		});
		if (authorizations.get(session.tabId) !== authorization || !authorization.valid) return;
		await syncState(session.tabId);
	} else {
		releaseRemoteObservation(session.tabId);
	}
	if (authorizations.get(session.tabId) !== authorization || !authorization.valid) return;
	publishRemoteChanged(
		session.tabId,
		session.sessionId,
		message.connected,
	);
}

function keepHostEventAlive(
	operation: Promise<void>,
	sendResponse: (response: unknown) => void,
): true {
	void operation.then(
		() => sendResponse({ settled: true }),
		(error: unknown) => {
			console.warn(LOG, 'Host event failed', error);
			sendResponse({ settled: false });
		},
	);
	// A response channel is the MV3 lifetime owner for work which must survive
	// the async restore/authentication boundary after a service-worker restart.
	return true;
}

async function closeTabSessionOnce(tabId: number): Promise<void> {
	let lastError: unknown;
	try {
		// Never wait for HELLO and never create a document on teardown. CLOSE_TAB is
		// deliberately capability-free so a restarted worker can destroy an unknown
		// pending or authenticated session directly in the already-existing host.
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				await sendOffscreenMessageIfPresent({
					type: 'REMOTE_HOST_CLOSE_TAB',
					tabId,
				});
				return;
			} catch (error) {
				lastError = error;
				const backoff = Math.min(1000 * 2 ** attempt, 4000);
				await new Promise((r) => setTimeout(r, backoff));
			}
		}
	} finally {
		forgetSession(tabId);
	}
	const detail = lastError instanceof Error ? lastError.message : String(lastError);
	throw new Error(`Unable to destroy remote session for closed tab ${tabId}: ${detail}`, {
		cause: lastError,
	});
}

function closeTabSession(tabId: number): Promise<void> {
	const currentAuthority = remoteTabAuthority(tabId);
	if (currentAuthority.closing && !currentAuthority.closeCompleted) {
		return currentAuthority.tail.then(() => undefined);
	}
	const authority = beginRemoteTabClose(tabId);
	return enqueueRemoteTab(tabId, async () => {
		try {
			await closeTabSessionOnce(tabId);
		} finally {
			completeRemoteTabClose(tabId, authority);
		}
	});
}

export function initRemoteService(): void {
	setStateCallback(sendStateToOffscreen);
	void ensureRemoteSessionsRestored().catch((error) => console.warn(LOG, 'Session restore failed', error));

	chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
		if (isAttemptedRemoteSessionMessage(rawMessage)) {
			if (!isTrustedExtensionUi(sender)) {
				sendResponse(rpcFailure('forbidden', 'Remote session RPC is extension-UI only'));
				return false;
			}
			if (!isBackgroundRequestEnvelope(rawMessage)) {
				sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed SPECTRA v3 remote request'));
				return false;
			}
			const operation = async () => {
				if (rawMessage.type === 'spectra.remote.session.get') {
					return rpcSuccess(await getSession(rawMessage.payload.tabId));
				}
				if (rawMessage.type === 'spectra.remote.session.create') {
					const result = await createSession(rawMessage.payload.tabId);
					return result.success && result.session
						? rpcSuccess(result.session)
						: rpcFailure('remote_create_failed', result.error ?? 'Unable to create remote session', true);
				}
				if (rawMessage.type === 'spectra.remote.session.close') {
					const result = await closeSession(rawMessage.payload.tabId, rawMessage.payload.sessionId);
					return result.success
						? rpcSuccess({ closed: true as const })
						: rpcFailure('remote_close_failed', result.error ?? 'Unable to close remote session');
				}
				return rpcFailure('unsupported_request', 'No remote handler for this request');
			};
			void operation().then(sendResponse).catch((error: unknown) => {
				sendResponse(rpcFailure(
					'remote_unavailable',
					error instanceof Error ? error.message : String(error),
					true,
				));
			});
			return true;
		}
		if (!isRecord(rawMessage)) return false;
		const message = rawMessage;

		if (!isTrustedOffscreenSender(sender)) return false;
		if (!isOffscreenHostEvent(message)) return false;

		if (message.type === 'REMOTE_HOST_EXECUTE_COMMAND') {
			const operation = enqueueBoundedSerial(
				remoteCommandQueues,
				message.sessionId,
				REMOTE_COMMAND_PENDING_LIMIT,
				() => handleHostCommand(message),
			);
			if (!operation) {
				sendResponse({ settled: false, error: 'REMOTE_COMMAND_BUSY' });
				return false;
			}
			return keepHostEventAlive(operation, sendResponse);
		}
		if (message.type === 'REMOTE_HOST_REQUEST_SYNC') {
			const operation = enqueueBoundedSerial(
				remoteSessionQueues,
				message.sessionId,
				REMOTE_COMMAND_PENDING_LIMIT,
				() => handleHostSync(message),
			);
			if (!operation) {
				sendResponse({ settled: false, error: 'REMOTE_EVENT_BUSY' });
				return false;
			}
			return keepHostEventAlive(operation, sendResponse);
		}
		if (message.type === 'REMOTE_HOST_STATUS_CHANGE') {
			fenceDisconnectedHostEvent(message);
			if (!message.connected) {
				// The synchronous fence above already revokes command authority. Status
				// publication itself does not need to wait behind a long command queue.
				return keepHostEventAlive(handleHostStatusChange(message), sendResponse);
			}
			const operation = enqueueBoundedSerial(
				remoteSessionQueues,
				message.sessionId,
				REMOTE_COMMAND_PENDING_LIMIT,
				() => handleHostStatusChange(message),
			);
			if (!operation) {
				sendResponse({ settled: false, error: 'REMOTE_EVENT_BUSY' });
				return false;
			}
			return keepHostEventAlive(operation, sendResponse);
		}
		if (message.type === 'REMOTE_HOST_SESSION_CLOSED') {
			const known = authorizations.get(message.tabId);
			if (known?.session.sessionId === message.sessionId) {
				forgetSession(message.tabId);
				publishRemoteClosed(message.tabId, message.sessionId);
			}
			return false;
		}

		return false;
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		void closeTabSession(tabId).catch((error) => console.warn(LOG, 'Tab session close deferred', error));
	});
}

async function assertControllableTab(tabId: number): Promise<void> {
	const tab = await chrome.tabs.get(tabId);
	if (!tab.url) throw new Error('TAB_UNAVAILABLE');
	let protocol: string;
	try {
		protocol = new URL(tab.url).protocol;
	} catch {
		throw new Error('TAB_UNAVAILABLE');
	}
	if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') throw new Error('TAB_NOT_CONTROLLABLE');
}

function isTrustedOffscreenSender(sender: chrome.runtime.MessageSender): boolean {
	return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('offscreen.html');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
