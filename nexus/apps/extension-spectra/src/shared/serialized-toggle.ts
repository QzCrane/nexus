// goal: preserve every rapid binary-toggle intent while rebasing on the last acknowledged state

export interface SerializedToggleOptions<T> {
	readCurrent: () => T;
	nextValue: (current: T) => T;
	commit: (next: T) => Promise<void>;
	setBusy: (busy: boolean) => void;
	onError: (error: unknown) => void;
}

export interface SerializedToggleQueue {
	enqueue: () => Promise<void>;
}

// post: each enqueued intent computes its value only after the preceding
// commit settles, so two rapid toggles never collapse into one stale write.
export function createSerializedToggleQueue<T>(
	options: SerializedToggleOptions<T>,
): SerializedToggleQueue {
	let tail: Promise<void> = Promise.resolve();
	let pending = 0;

	return {
		enqueue: () => {
			pending += 1;
			if (pending === 1) options.setBusy(true);
			const operation = tail.then(async () => {
				await options.commit(options.nextValue(options.readCurrent()));
			});
			tail = operation.catch(() => undefined);
			const finish = (): void => {
				pending -= 1;
				if (pending === 0) options.setBusy(false);
			};
			void operation.then(
				finish,
				(error: unknown) => {
					try {
						options.onError(error);
					} finally {
						finish();
					}
				},
			).catch((error: unknown) => {
				console.error('[SPECTRA] Toggle error presentation failed:', error);
			});
			return operation;
		},
	};
}
