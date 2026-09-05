/**
 * Bounded serial admission for Remote events that share one logical key.
 *
 * The queue owns only ordering, admission, and map cleanup. Session identity,
 * authorization, cancellation, and protocol semantics remain with the
 * Background Remote service.
 */
export interface BoundedSerialQueue {
	tail: Promise<void>;
	pending: number;
}

export function enqueueBoundedSerial<T>(
	queues: Map<string, BoundedSerialQueue>,
	key: string,
	limit: number,
	operation: () => Promise<T>,
): Promise<T> | null {
	const queue = queues.get(key) ?? { tail: Promise.resolve(), pending: 0 };
	if (queue.pending >= limit) return null;
	queue.pending += 1;
	queues.set(key, queue);

	const current = queue.tail.then(operation, operation);
	const tail = current.then(() => undefined, () => undefined);
	queue.tail = tail;
	void current.finally(() => {
		queue.pending -= 1;
		if (queue.pending === 0 && queues.get(key) === queue) queues.delete(key);
	}).catch(() => undefined);
	return current;
}
