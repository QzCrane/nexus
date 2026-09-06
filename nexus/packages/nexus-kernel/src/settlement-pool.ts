// goal: limit physically outstanding keyed work without confusing an observer deadline with cancellation
// inv: a permit is released only when the underlying operation settles; the pool has no unbounded wait queue

export interface SettlementPool<K, V> {
	getOrStart(key: K, start: () => Promise<V>): Promise<V> | null;
	readonly pendingCount: number;
}

export function createSettlementPool<K, V>(concurrency: number): SettlementPool<K, V> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive safe integer');
	const pending = new Map<K, Promise<V>>();
	return {
		get pendingCount() { return pending.size; },
		getOrStart(key, start) {
			const existing = pending.get(key);
			if (existing) return existing;
			if (pending.size >= concurrency) return null;
			// Claim the key before invoking user code, including synchronous failures.
			const operation = Promise.resolve().then(start);
			pending.set(key, operation);
			const release = () => { if (pending.get(key) === operation) pending.delete(key); };
			void operation.then(release, release);
			return operation;
		},
	};
}

export type DeadlineObservation<T> = { settled: true; value: T } | { settled: false };

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
interface ObservationHub { outcome?: Outcome; listeners: Set<(outcome: Outcome) => void> }
const observations = new WeakMap<Promise<unknown>, ObservationHub>();

// Only one reaction is ever retained by a physical operation. Expired callers
// unregister from its removable subscriber set, even if it never settles.
export function observeWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<DeadlineObservation<T>> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error('timeout must fit a positive timer delay');
	let hub = observations.get(operation);
	if (!hub) {
		hub = { listeners: new Set() };
		observations.set(operation, hub);
		const owner = hub;
		const settle = (outcome: Outcome) => {
			owner.outcome = outcome;
			for (const notify of owner.listeners) notify(outcome);
			owner.listeners.clear();
		};
		void operation.then((value) => settle({ ok: true, value }), (error: unknown) => settle({ ok: false, error }));
	}
	const owner = hub;
	return new Promise((resolve, reject) => {
		if (owner.outcome) {
			if (owner.outcome.ok) resolve({ settled: true, value: owner.outcome.value as T });
			else reject(owner.outcome.error);
			return;
		}
		const notify = (outcome: Outcome) => {
			clearTimeout(timer);
			owner.listeners.delete(notify);
			if (outcome.ok) resolve({ settled: true, value: outcome.value as T });
			else reject(outcome.error);
		};
		const timer = setTimeout(() => {
			owner.listeners.delete(notify);
			resolve({ settled: false });
		}, timeoutMs);
		owner.listeners.add(notify);
	});
}
