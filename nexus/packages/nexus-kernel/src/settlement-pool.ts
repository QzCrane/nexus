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

// This bounds only the caller's observation. It neither cancels the operation
// nor gives the caller permission to release a physically occupied pool slot.
export function observeWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<DeadlineObservation<T>> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be finite and positive');
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
		void operation.then(
			(value) => { clearTimeout(timer); resolve({ settled: true, value }); },
			(error: unknown) => { clearTimeout(timer); reject(error); },
		);
	});
}
