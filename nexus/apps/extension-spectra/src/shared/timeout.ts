// goal: the single owner of deadline enforcement for cross-context RPC
//
// Every await on another extension context can fail to settle: a Service Worker
// can be reclaimed mid-flight, an offscreen handler can await a resource that
// never resolves, and a Content listener can be torn down between delivery and
// reply. Without a deadline the awaiting side parks forever, and because most of
// these awaits sit inside per-tab serialized queues, one parked call blocks every
// later operation for that tab.
//
// A deadline is therefore a correctness requirement, not an optimization.

export class DeadlineExceededError extends Error {
	readonly label: string;
	readonly timeoutMs: number;

	constructor(label: string, timeoutMs: number) {
		super(`${label} did not settle within ${timeoutMs}ms`);
		this.name = 'DeadlineExceededError';
		this.label = label;
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Resolves with `promise`, or rejects with {@link DeadlineExceededError} once
 * `timeoutMs` elapses. The timer is always cleared, including on rejection, so a
 * settled call never keeps the Service Worker alive.
 */
export function withDeadline<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError(`withDeadline requires a positive finite timeout for ${label}`);
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new DeadlineExceededError(label, timeoutMs));
		}, timeoutMs);
		promise.then(
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

/**
 * Budgets for cross-context RPC. Kept here so they cannot drift per call site.
 *
 * Nesting invariant: a transport-level deadline must be strictly longer than any
 * deadline a caller applies to the same operation. Otherwise the transport
 * deadline fires first and the caller's own budget becomes unreachable — the
 * operation is killed earlier than its owner declared it may take, and the owner
 * reports a generic transport failure instead of its specific one.
 *
 * `offscreen` therefore sits above `OFFSCREEN_ACK_TIMEOUT_MS` (15s in
 * `handlers/capture.ts`): a capture start is allowed 15s by its owner, so the
 * enclosing dispatch must not cut it at 10s.
 */
export const RPC_DEADLINE_MS = {
	/** Offscreen host round trip; must enclose `OFFSCREEN_ACK_TIMEOUT_MS`. */
	offscreen: 20_000,
	/** Single Content request that is expected to answer promptly. */
	contentRequest: 5_000,
	/** Content request that may wait on a runtime lease being established. */
	contentRuntime: 15_000,
	/** Envelope request whose handler may fan out to the offscreen host. */
	backgroundRequest: 25_000,
} as const;
