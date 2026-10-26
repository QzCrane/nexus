// goal: the two projections of an Offscreen host session that may leave Background

import type { RemotePublicSession, RemoteSessionView } from '@nexus/contracts';
import type { RemoteHostSession } from '@nexus/contracts';

export type HostSession = RemoteHostSession;

/**
 * The pairing projection. `secret` is bearer pairing authority: whoever holds it
 * can attach a new device to this tab, so this shape may leave Background from
 * exactly one place — the `create` reply, whose caller is about to render the QR
 * code. Everything else uses {@link toSessionView}.
 */
export function toPublicSession(session: HostSession): RemotePublicSession {
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

/**
 * The read-back projection: everything a UI needs to describe an established
 * session, and nothing that would let a reader re-pair it (SP-30). A status
 * query answers "is this tab paired", so it must not double as a second way to
 * obtain pairing authority.
 */
export function toSessionView(session: HostSession): RemoteSessionView {
	const {
		secret: _secret,
		...view
	} = toPublicSession(session);
	return view;
}
