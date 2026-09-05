// goal: bounded fan-out for tab-scaled background work

export async function forEachBounded<T>(
	items: readonly T[],
	concurrency: number,
	operation: (item: T, index: number) => Promise<void>,
): Promise<void> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error('Bounded fan-out concurrency must be a positive integer');
	}
	let cursor = 0;
	let hasFailure = false;
	let failure: unknown;
	const workerCount = Math.min(concurrency, items.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (!hasFailure && cursor < items.length) {
			const index = cursor;
			cursor += 1;
			const item = items[index];
			if (item === undefined) continue;
			try {
				await operation(item, index);
			} catch (error: unknown) {
				if (!hasFailure) {
					hasFailure = true;
					failure = error;
				}
			}
		}
	});
	// Never reject while an earlier attempt still owns live workers: callers may
	// retry immediately, so early rejection would multiply the advertised cap.
	await Promise.all(workers);
	if (hasFailure) throw failure;
}
