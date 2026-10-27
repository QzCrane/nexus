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
 * The four ways a claim can fail to be admitted. Named because a silent
 * `return base` is how a dead state (`applying`) survived months: the refusal
 * happened, and nothing could say which kind it was.
 */
export type Rejection =
	| { readonly code: 'no_evidence'; readonly missing: readonly string[] }
	| { readonly code: 'intent_cancelled'; readonly intentId: string }
	| { readonly code: 'stale_sequence'; readonly seen: number; readonly got: number }
	| { readonly code: 'illegal_transition'; readonly from: string; readonly to: string };

export type Verdict<T> =
	| { readonly ok: true; readonly state: T; readonly corrections: readonly Rejection[] }
	| { readonly ok: false; readonly reason: Rejection; readonly current: T | null };

/**
 * `corrections` is what the admission had to fix before it could say yes. An
 * accepted-but-corrected claim is not the same as a clean one, and collapsing
 * the two is how a silently downgraded phase went unnoticed.
 */
export function accept<T>(state: T, corrections: readonly Rejection[] = []): Verdict<T> {
	return { ok: true, state, corrections };
}

/**
 * `current` is the state the refusal left in place. A caller that only knows "it
 * did not happen" cannot act; one that also gets "and here is what still holds"
 * can carry on without a second read.
 */
export function reject<T>(reason: Rejection, current: T | null = null): Verdict<T> {
	return { ok: false, reason, current };
}

/**
 * Whether a caller may try the same claim again. `no_evidence` means the proof
 * had not arrived yet, so retrying can succeed; the other three mean the claim
 * is settled and a retry would only re-lose.
 *
 * This is the first consumer of {@link Rejection}: a named reason is what lets
 * a caller distinguish "not yet" from "never".
 */
export function isRejection(value: unknown): value is Rejection {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	switch (candidate.code) {
		case 'no_evidence':
			return Array.isArray(candidate.missing)
				&& candidate.missing.every((entry) => typeof entry === 'string');
		case 'intent_cancelled':
			return typeof candidate.intentId === 'string';
		case 'stale_sequence':
			return Number.isSafeInteger(candidate.seen) && Number.isSafeInteger(candidate.got);
		case 'illegal_transition':
			return typeof candidate.from === 'string' && typeof candidate.to === 'string';
		default:
			return false;
	}
}

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
