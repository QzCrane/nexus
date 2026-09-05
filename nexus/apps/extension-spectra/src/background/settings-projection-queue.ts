// goal: coalesce durable settings revisions into one bounded, retryable projection owner

export interface RevisionedSnapshot {
	revision: number;
}

export interface SettingsProjectionWork<T extends RevisionedSnapshot> {
	snapshot: T;
	global: boolean;
	hotkeys: boolean;
	mediaRouteDomains: string[];
	mediaRoutesAll: boolean;
}

export interface SettingsProjectionQueueOptions<T extends RevisionedSnapshot> {
	project(work: SettingsProjectionWork<T>): Promise<void>;
	onSuccess(work: SettingsProjectionWork<T>): Promise<void> | void;
	onDeferred(work: SettingsProjectionWork<T>, error: unknown): Promise<void> | void;
	delay(milliseconds: number): Promise<void>;
	retryDelaysMs?: readonly number[];
}

function mergeWork<T extends RevisionedSnapshot>(
	left: SettingsProjectionWork<T> | null,
	right: SettingsProjectionWork<T>,
): SettingsProjectionWork<T> {
	if (!left) return right;
	return {
		snapshot: right.snapshot.revision >= left.snapshot.revision ? right.snapshot : left.snapshot,
		global: left.global || right.global,
		hotkeys: left.hotkeys || right.hotkeys,
		mediaRouteDomains: [...new Set([...left.mediaRouteDomains, ...right.mediaRouteDomains])],
		mediaRoutesAll: left.mediaRoutesAll || right.mediaRoutesAll,
	};
}

export class SettingsProjectionQueue<T extends RevisionedSnapshot> {
	private pending: SettingsProjectionWork<T> | null = null;
	private running: Promise<void> | null = null;
	private deferred = false;
	private readonly retryDelaysMs: readonly number[];

	constructor(private readonly options: SettingsProjectionQueueOptions<T>) {
		this.retryDelaysMs = options.retryDelaysMs ?? [50, 200, 800];
	}

	enqueue(work: SettingsProjectionWork<T>): void {
		this.pending = mergeWork(this.pending, work);
		this.deferred = false;
		this.start();
	}

	wake(): void {
		this.deferred = false;
		this.start();
	}

	async whenIdle(): Promise<void> {
		while (this.running) await this.running;
	}

	private start(): void {
		if (this.running || this.deferred || !this.pending) return;
		const operation = this.drain().finally(() => {
			if (this.running === operation) this.running = null;
			if (this.pending && !this.deferred) this.start();
		});
		this.running = operation;
	}

	private async drain(): Promise<void> {
		let failures = 0;
		while (this.pending) {
			const work = this.pending;
			this.pending = null;
			try {
				await this.options.project(work);
				await this.options.onSuccess(work);
				failures = 0;
			} catch (error) {
				this.pending = mergeWork(this.pending, work);
				const retryDelay = this.retryDelaysMs[failures];
				if (retryDelay !== undefined) {
					failures += 1;
					await this.options.delay(retryDelay);
					continue;
				}
				this.deferred = true;
				await this.options.onDeferred(this.pending, error);
				return;
			}
		}
	}
}
