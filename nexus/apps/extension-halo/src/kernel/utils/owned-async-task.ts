export type OwnedTaskPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface OwnedTaskExecution<T> {
	promise: Promise<T>;
	dispose?: () => void;
}

export type OwnedTaskOutcome<T> =
	| { kind: 'succeeded'; value: T }
	| { kind: 'failed'; error: unknown }
	| { kind: 'cancelled'; reason: 'cancelled' | 'superseded' | 'disposed' | 'deadline' };

export interface OwnedTaskSnapshot {
	phase: OwnedTaskPhase;
	error: unknown;
}

export const DEFAULT_UI_TASK_DEADLINE_MS = 15_000;

export class OwnedAsyncTask {
	private generation = 0;
	private active: {
		finish: (outcome: OwnedTaskOutcome<never>) => void;
		dispose: () => void;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	private disposed = false;

	constructor(private readonly publish: (snapshot: OwnedTaskSnapshot) => void = () => undefined) {}

	async run<T>(
		start: () => Promise<T> | OwnedTaskExecution<T>,
		deadlineMs = DEFAULT_UI_TASK_DEADLINE_MS,
	): Promise<OwnedTaskOutcome<T>> {
		if (this.disposed) return { kind: 'cancelled', reason: 'disposed' };
		if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
			const error = new RangeError('Task deadline must be a positive finite number');
			this.publish({ phase: 'failed', error });
			return { kind: 'failed', error };
		}
		this.cancel('superseded');
		const generation = ++this.generation;
		this.publish({ phase: 'running', error: null });

		let execution: OwnedTaskExecution<T>;
		try {
			const started = start();
			execution = started instanceof Promise ? { promise: started } : started;
		} catch (error) {
			this.publish({ phase: 'failed', error });
			return { kind: 'failed', error };
		}

		let settled = false;
		const outcome = new Promise<OwnedTaskOutcome<T>>((resolve) => {
			const finish = (next: OwnedTaskOutcome<T>): void => {
				if (settled) return;
				settled = true;
				resolve(next);
			};
			const dispose = once(execution.dispose ?? (() => undefined));
			const timer = setTimeout(() => {
				dispose();
				finish({ kind: 'cancelled', reason: 'deadline' });
			}, deadlineMs);
			this.active = {
				finish: finish as (outcome: OwnedTaskOutcome<never>) => void,
				dispose,
				timer,
			};
			void execution.promise.then(
				(value) => finish({ kind: 'succeeded', value }),
				(error) => finish({ kind: 'failed', error }),
			);
		});

		const result = await outcome;
		if (generation !== this.generation) return result;
		const current = this.active;
		if (current) {
			clearTimeout(current.timer);
			current.dispose();
			this.active = null;
		}
		if (result.kind === 'succeeded') this.publish({ phase: 'succeeded', error: null });
		else if (result.kind === 'failed') this.publish({ phase: 'failed', error: result.error });
		else this.publish({ phase: 'cancelled', error: result.reason === 'deadline' ? new Error('Task deadline exceeded') : null });
		return result;
	}

	cancel(reason: 'cancelled' | 'superseded' | 'disposed' = 'cancelled'): void {
		const current = this.active;
		if (!current) return;
		this.generation += 1;
		clearTimeout(current.timer);
		current.dispose();
		current.finish({ kind: 'cancelled', reason });
		this.active = null;
		if (!this.disposed && reason !== 'superseded') this.publish({ phase: 'cancelled', error: null });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel('disposed');
	}

	get isDisposed(): boolean {
		return this.disposed;
	}
}

function once(dispose: () => void): () => void {
	let called = false;
	return () => {
		if (called) return;
		called = true;
		dispose();
	};
}
