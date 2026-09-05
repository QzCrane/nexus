// goal: runs Popup card initialization with bounded concurrency and waits for every item despite isolated failures

export interface CardBootstrapSummary {
	succeeded: number;
	skipped: number;
	failures: unknown[];
}

export async function runBoundedCardBootstrap<T>(
	items: readonly T[],
	concurrency: number,
	initialize: (item: T) => Promise<boolean>,
): Promise<CardBootstrapSummary> {
	const summary: CardBootstrapSummary = { succeeded: 0, skipped: 0, failures: [] };
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const item = items[nextIndex];
			nextIndex += 1;
			if (item === undefined) continue;
			try {
				if (await initialize(item)) summary.succeeded += 1;
				else summary.skipped += 1;
			} catch (error) {
				summary.failures.push(error);
			}
		}
	};
	const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return summary;
}
