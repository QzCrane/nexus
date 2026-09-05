// goal: keep only the latest local intent per settings key authoritative across asynchronous mutations

export interface LatestIntentSettlement<Snapshot> {
	project: (snapshot: Snapshot) => void;
	recover: () => Promise<Snapshot>;
	onError: (error: unknown) => void;
}

export class LatestKeyedIntentRegistry<Key, Value> {
	private readonly pending = new Map<Key, { token: number; value: Value }>();
	private nextToken = 0;

	begin(key: Key, value: Value): number {
		const token = ++this.nextToken;
		this.pending.set(key, { token, value });
		return token;
	}

	entries(): IterableIterator<[Key, { token: number; value: Value }]> {
		return this.pending.entries();
	}

	async settle<Snapshot>(
		key: Key,
		token: number,
		mutation: Promise<Snapshot>,
		handlers: LatestIntentSettlement<Snapshot>,
	): Promise<void> {
		let snapshot: Snapshot;
		try {
			snapshot = await mutation;
		} catch (error) {
			if (!this.releaseIfCurrent(key, token)) return;
			handlers.onError(error);
			try {
				handlers.project(await handlers.recover());
			} catch (recoveryError) {
				handlers.onError(recoveryError);
			}
			return;
		}

		if (!this.releaseIfCurrent(key, token)) return;
		try {
			handlers.project(snapshot);
		} catch (error) {
			handlers.onError(error);
		}
	}

	private releaseIfCurrent(key: Key, token: number): boolean {
		if (this.pending.get(key)?.token !== token) return false;
		this.pending.delete(key);
		return true;
	}
}
