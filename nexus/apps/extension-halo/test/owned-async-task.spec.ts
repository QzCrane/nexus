import { describe, expect, test } from 'bun:test';
import { OwnedAsyncTask } from '../src/kernel/utils/owned-async-task';
import { oneShotWorker, type OneShotWorkerLike } from '../src/kernel/utils/one-shot-worker';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('owned async task', () => {
	test('supersedes a slow task, disposes it once and admits only the latest result', async () => {
		const snapshots: string[] = [];
		const owner = new OwnedAsyncTask((snapshot) => snapshots.push(snapshot.phase));
		const first = deferred<string>();
		let firstDisposals = 0;
		const firstRun = owner.run(() => ({ promise: first.promise, dispose: () => { firstDisposals += 1; } }));
		const secondRun = owner.run(() => Promise.resolve('second'));
		expect(await firstRun).toEqual({ kind: 'cancelled', reason: 'superseded' });
		expect(await secondRun).toEqual({ kind: 'succeeded', value: 'second' });
		first.resolve('late');
		await Promise.resolve();
		expect(firstDisposals).toBe(1);
		expect(snapshots.at(-1)).toBe('succeeded');
	});

	test('physically disposes a task at its deadline and ignores a late rejection', async () => {
		const task = deferred<void>();
		let disposals = 0;
		const owner = new OwnedAsyncTask();
		const outcome = await owner.run(() => ({ promise: task.promise, dispose: () => { disposals += 1; } }), 5);
		expect(outcome).toEqual({ kind: 'cancelled', reason: 'deadline' });
		task.reject(new Error('late'));
		await Promise.resolve();
		expect(disposals).toBe(1);
	});

	test('preserves the original domain error', async () => {
		const error = new RangeError('domain failure');
		const outcome = await new OwnedAsyncTask().run(() => Promise.reject(error));
		expect(outcome).toEqual({ kind: 'failed', error });
	});
});

describe('one-shot worker execution', () => {
	test('terminates after one response and forwards the transfer list', async () => {
		let terminations = 0;
		let posted: unknown;
		let transferred: Transferable[] | undefined;
		const worker: OneShotWorkerLike = {
			onmessage: null,
			onerror: null,
			onmessageerror: null,
			postMessage(message, transfer) {
				posted = message;
				transferred = transfer;
				queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: true } })));
			},
			terminate() { terminations += 1; },
		};
		const buffer = new ArrayBuffer(4);
		const execution = oneShotWorker(() => worker, { input: true }, [buffer]);
		expect(await execution.promise).toEqual({ ok: true });
		expect(posted).toEqual({ input: true });
		expect(transferred).toEqual([buffer]);
		expect(terminations).toBe(1);
		execution.dispose?.();
		expect(terminations).toBe(1);
	});

	test('termination prevents late worker messages from settling the task', async () => {
		const worker: OneShotWorkerLike = {
			onmessage: null, onerror: null, onmessageerror: null,
			postMessage() {}, terminate() {},
		};
		const execution = oneShotWorker(() => worker, 'request');
		const owner = new OwnedAsyncTask();
		const run = owner.run(() => execution);
		owner.cancel();
		worker.onmessage?.(new MessageEvent('message', { data: 'late' }));
		expect(await run).toEqual({ kind: 'cancelled', reason: 'cancelled' });
	});
});
