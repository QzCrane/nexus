import { describe, expect, test } from 'bun:test';
import { LatestKeyedIntentRegistry } from '../src/options/latest-keyed-intent';

interface Snapshot {
	value: string;
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	return {
		promise: new Promise<T>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		}),
		resolve,
		reject,
	};
}

describe('latest keyed intent registry', () => {
	test('ignores an older failure and projects the newer successful intent', async () => {
		const registry = new LatestKeyedIntentRegistry<string, string>();
		const first = deferred<Snapshot>();
		const second = deferred<Snapshot>();
		const projections: string[] = [];
		const errors: unknown[] = [];
		const recoveries: number[] = [];
		const handlers = {
			project: (snapshot: Snapshot) => projections.push(snapshot.value),
			recover: async () => {
				recoveries.push(1);
				return { value: 'A' };
			},
			onError: (error: unknown) => errors.push(error),
		};

		const firstToken = registry.begin('slot_1', 'B');
		const firstSettlement = registry.settle('slot_1', firstToken, first.promise, handlers);
		const secondToken = registry.begin('slot_1', 'C');
		const secondSettlement = registry.settle('slot_1', secondToken, second.promise, handlers);
		first.reject(new Error('first rejected'));
		second.resolve({ value: 'C' });
		await Promise.all([firstSettlement, secondSettlement]);

		expect(projections).toEqual(['C']);
		expect(errors).toEqual([]);
		expect(recoveries).toEqual([]);
	});

	test('reloads and projects canonical state when the latest intent fails', async () => {
		const registry = new LatestKeyedIntentRegistry<string, string>();
		const mutation = deferred<Snapshot>();
		const projections: string[] = [];
		const errors: unknown[] = [];
		const token = registry.begin('slot_1', 'C');
		const settlement = registry.settle('slot_1', token, mutation.promise, {
			project: snapshot => projections.push(snapshot.value),
			recover: async () => ({ value: 'A' }),
			onError: error => errors.push(error),
		});
		mutation.reject(new Error('latest rejected'));
		await settlement;

		expect(projections).toEqual(['A']);
		expect(errors).toHaveLength(1);
		expect([...registry.entries()]).toEqual([]);
	});
});
