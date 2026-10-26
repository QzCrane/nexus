// goal: the four shapes every authority in SPECTRA shares, declared once
//
// Five machines, eight bounded processes and a transport that crosses four
// contexts do not need five vocabularies for "someone claims X", "X was
// refused", and "this collection must not grow". They need one.
//
// Nothing here is a state machine. A state machine answers "what may follow
// what"; these answer three questions the machines kept asking separately:
//
//   - Fact:      who claims this, about which identity, and what proves it?
//   - Verdict:   accepted, or refused for a named reason?
//   - Rejection: which of the four ways a claim can fail to be admitted?
//   - Bounded:   how large, how old, and who sweeps it?

/**
 * A claim that carries its own proof.
 *
 * `version` is a Lamport-style order, never an authority: a higher version
 * means "later", not "more true". Every admission decision must be reachable
 * from `proof` alone (§5.6).
 */
export interface Fact<T, P> {
	readonly authority: 'offscreen' | 'content' | 'background';
	readonly identity: string;
	readonly version: number;
	readonly at: number;
	readonly value: T;
	readonly proof: P;
}

/**
 * The four ways a claim can fail to be admitted. Named because a silent
 * `return base` is how a dead state (`applying`) survived months: the refusal
 * happened, and nothing could say which kind it was.
 */
export type Rejection =
	| { readonly code: 'no_evidence'; readonly missing: readonly string[] }
	| { readonly code: 'intent_cancelled'; readonly intentId: string }
	| { readonly code: 'stale_sequence'; readonly seen: number; readonly got: number }
	| { readonly code: 'illegal_transition'; readonly from: string; readonly to: string };

export interface Effect {
	readonly kind: 'persist' | 'broadcast' | 'acquire' | 'release';
	readonly target: string;
}

export type Verdict<T> =
	| { readonly ok: true; readonly state: T; readonly effects: readonly Effect[] }
	| { readonly ok: false; readonly reason: Rejection };

export function accept<T>(state: T, effects: readonly Effect[] = []): Verdict<T> {
	return { ok: true, state, effects };
}

export function reject<T>(reason: Rejection): Verdict<T> {
	return { ok: false, reason };
}

/**
 * Whether a caller may try the same claim again. `no_evidence` means the proof
 * had not arrived yet, so retrying can succeed; the other three mean the claim
 * is settled and a retry would only re-lose.
 *
 * This is the first consumer of {@link Rejection}: a named reason is what lets
 * a caller distinguish "not yet" from "never".
 */
export function isRetryableRejection(reason: Rejection): boolean {
	return reason.code === 'no_evidence';
}

export function describeRejection(reason: Rejection): string {
	switch (reason.code) {
		case 'no_evidence':
			return `no evidence for ${reason.missing.join(', ')}`;
		case 'intent_cancelled':
			return `intent ${reason.intentId} was cancelled`;
		case 'stale_sequence':
			return `stale sequence: saw ${reason.seen}, got ${reason.got}`;
		case 'illegal_transition':
			return `illegal transition ${reason.from} -> ${reason.to}`;
	}
}
