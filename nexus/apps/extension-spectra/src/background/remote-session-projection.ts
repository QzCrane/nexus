// goal: the two projections of an Offscreen host session that may leave Background
//
// The key lists these pick from live beside the validators in
// `@nexus/contracts` (remote.contracts.ts). Nothing is restated here on purpose:
// a denylist projection sitting next to an allowlist validator is exactly how
// this repository produced SP-64 and SP-67, where two descriptions of one shape
// had to be kept in step by a human.

import {
	toRemotePublicSession,
	toRemoteSessionView,
} from '@nexus/contracts';
import type { RemoteHostSession } from '@nexus/contracts';
import type { RemotePublicSession, RemoteSessionView } from '../remote/protocol';

export type HostSession = RemoteHostSession;

/**
 * The pairing projection. `secret` is bearer pairing authority: whoever holds it
 * can attach a new device to this tab, so this shape may leave Background from
 * exactly one place — the `create` reply, whose caller is about to render the QR
 * code. Everything else uses {@link toSessionView}.
 */
export function toPublicSession(session: HostSession): RemotePublicSession {
	return toRemotePublicSession(session);
}

/**
 * The read-back projection: everything a UI needs to describe an established
 * session, and nothing that would let a reader re-pair it (SP-30). A status
 * query answers "is this tab paired", so it must not double as a second way to
 * obtain pairing authority.
 */
export function toSessionView(session: HostSession): RemoteSessionView {
	return toRemoteSessionView(session);
}
