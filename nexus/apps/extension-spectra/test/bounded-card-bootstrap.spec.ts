import { describe, expect, test } from 'bun:test';
import { runBoundedCardBootstrap } from '../src/popup/bounded-card-bootstrap';

describe('bounded Popup card bootstrap', () => {
	test('waits for late successes and continues after an isolated card failure', async () => {
		let releaseFirst: (() => void) | null = null;
		const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
		let settled = false;
		const run = runBoundedCardBootstrap([0, 1, 2], 2, async (item) => {
			if (item === 0) await first;
			if (item === 1) throw new Error('broken card');
			return true;
		}).then((summary) => {
			settled = true;
			return summary;
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(releaseFirst).not.toBeNull();
		releaseFirst?.();
		const summary = await run;
		expect(summary.succeeded).toBe(2);
		expect(summary.skipped).toBe(0);
		expect(summary.failures).toHaveLength(1);
	});

	test('normalizes invalid concurrency to one worker', async () => {
		let inFlight = 0;
		let peak = 0;
		const summary = await runBoundedCardBootstrap([1, 2, 3], 0, async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await Promise.resolve();
			inFlight -= 1;
			return false;
		});
		expect(peak).toBe(1);
		expect(summary.skipped).toBe(3);
	});
});
