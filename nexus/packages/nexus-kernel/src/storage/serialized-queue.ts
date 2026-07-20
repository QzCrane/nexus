// goal: shared serialized operation queue to prevent concurrent read-modify-write races

/**
 * Creates a single-key serialized queue. Each operation runs only after the
 * previous one completes (success or failure). The queue never rejects — a
 * failed operation does not block subsequent operations.
 */
export function createSerializedQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
	let queue: Promise<void> = Promise.resolve();
	return function serialized<T>(operation: () => Promise<T>): Promise<T> {
		const previous = queue;
		const result = previous.then(operation, operation);
		queue = result.then(() => undefined, () => undefined);
		return result;
	};
}

/**
 * Creates a per-key serialized queue. Operations with different keys run
 * concurrently; operations with the same key run sequentially. Entries are
 * auto-deleted when the queue drains, so idle keys consume no memory.
 */
export function createKeyedSerializedQueue<K>(): <T>(key: K, operation: () => Promise<T>) => Promise<T> {
	const queues = new Map<K, Promise<void>>();
	return function serialized<T>(key: K, operation: () => Promise<T>): Promise<T> {
		const previous = queues.get(key) ?? Promise.resolve();
		const result = previous.then(operation, operation);
		const tail = result.then(() => undefined, () => undefined);
		queues.set(key, tail);
		void tail.finally(() => {
			if (queues.get(key) === tail) queues.delete(key);
		});
		return result;
	};
}
