interface SerializedAsyncPollerDependencies {
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	schedule?: (
		callback: () => void,
		delayMs: number,
	) => ReturnType<typeof setTimeout>;
}

export interface SerializedAsyncPoller {
	dispose: () => void;
	start: () => void;
	stop: () => void;
	trigger: () => void;
}

export function createSerializedAsyncPoller<Result>(
	read: () => Promise<Result>,
	commit: (result: Result) => void,
	reportError: (error: unknown) => void,
	delayMs: number,
	dependencies: SerializedAsyncPollerDependencies = {},
): SerializedAsyncPoller {
	const schedule = dependencies.schedule ?? setTimeout;
	const clearTimer = dependencies.clearTimer ?? clearTimeout;
	let active = false;
	let disposed = false;
	let generation = 0;
	let running = false;
	let rerunRequested = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearScheduledRun = (): void => {
		if (timer === null) return;
		clearTimer(timer);
		timer = null;
	};

	const scheduleNext = (): void => {
		if (!active || disposed || timer !== null) return;
		timer = schedule(() => {
			timer = null;
			run();
		}, delayMs);
	};

	const run = (): void => {
		if (!active || disposed) return;
		if (running) {
			rerunRequested = true;
			return;
		}

		running = true;
		const runGeneration = generation;
		void read()
			.then(
				(result) => {
					if (
						active &&
						!disposed &&
						runGeneration === generation
					) {
						commit(result);
					}
				},
				(error: unknown) => {
					if (
						active &&
						!disposed &&
						runGeneration === generation
					) {
						reportError(error);
					}
				},
			)
			.finally(() => {
				running = false;
				if (!active || disposed) return;
				if (rerunRequested || runGeneration !== generation) {
					rerunRequested = false;
					run();
					return;
				}
				scheduleNext();
			});
	};

	return {
		dispose() {
			disposed = true;
			active = false;
			generation += 1;
			rerunRequested = false;
			clearScheduledRun();
		},
		start() {
			if (disposed || active) return;
			active = true;
			generation += 1;
			run();
		},
		stop() {
			if (!active) return;
			active = false;
			generation += 1;
			rerunRequested = false;
			clearScheduledRun();
		},
		trigger() {
			run();
		},
	};
}
