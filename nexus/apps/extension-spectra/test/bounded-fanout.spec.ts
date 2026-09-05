import { describe, expect, test } from 'bun:test';
import { forEachBounded } from '../src/background/bounded-fanout';

describe('bounded background fan-out', () => {
	test('waits for all live workers before surfacing an error', async () => {
		let active = 0;
		let maxActive = 0;
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		let settled = false;
		const operation = forEachBounded([0, 1, 2, 3], 3, async (item) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			try {
				if (item === 0) throw new Error('fail-fast');
				await blocked;
			} finally {
				active -= 1;
			}
		});
		void operation.finally(() => { settled = true; }).catch(() => undefined);
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(active).toBeGreaterThan(0);
		release?.();
		await expect(operation).rejects.toThrow('fail-fast');
		expect(active).toBe(0);
		expect(maxActive).toBeLessThanOrEqual(3);
	});

	test('preserves a rejection whose reason is undefined', async () => {
		await expect(forEachBounded([0], 1, async () => {
			return Promise.reject(undefined);
		})).rejects.toBeUndefined();
	});
});
