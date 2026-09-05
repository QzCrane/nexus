import { describe, expect, test } from 'bun:test';
import { createSerializedToggleQueue } from '../src/shared/serialized-toggle';

describe('serialized toggle intent queue', () => {
	test('rebases every rapid toggle on the preceding acknowledged value', async () => {
		let current: 'light' | 'dark' = 'light';
		const commits: Array<'light' | 'dark'> = [];
		const busy: boolean[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
		const queue = createSerializedToggleQueue({
			readCurrent: () => current,
			nextValue: value => value === 'light' ? 'dark' : 'light',
			commit: async value => {
				commits.push(value);
				if (commits.length === 1) await firstGate;
				current = value;
			},
			setBusy: value => busy.push(value),
			onError: error => { throw error; },
		});

		const first = queue.enqueue();
		const second = queue.enqueue();
		await Promise.resolve();
		expect(commits).toEqual(['dark']);
		releaseFirst();
		await Promise.all([first, second]);
		await Promise.resolve();

		expect(commits).toEqual(['dark', 'light']);
		expect(current).toBe('light');
		expect(busy).toEqual([true, false]);
	});

	test('continues with the next intent after a rejected commit', async () => {
		let current = false;
		let attempts = 0;
		const errors: unknown[] = [];
		const queue = createSerializedToggleQueue({
			readCurrent: () => current,
			nextValue: value => !value,
			commit: async value => {
				attempts += 1;
				if (attempts === 1) throw new Error('transient');
				current = value;
			},
			setBusy: () => undefined,
			onError: error => errors.push(error),
		});

		await Promise.allSettled([queue.enqueue(), queue.enqueue()]);
		await Promise.resolve();

		expect(attempts).toBe(2);
		expect(current).toBe(true);
		expect(errors).toHaveLength(1);
	});
});
