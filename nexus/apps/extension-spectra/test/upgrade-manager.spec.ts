import { describe, expect, test } from 'bun:test';
import {
	refreshTabsForUpgrade,
	WARM_UPDATE_CONCURRENCY,
} from '../src/background/upgrade-manager';

describe('MV3 warm update scheduling', () => {
	test('awaits active tabs first and processes every background tab with bounded concurrency', async () => {
		const activeIds = [1, 2];
		const backgroundIds = [3, 4, 5, 6, 7, 8, 9];
		const visited: number[] = [];
		let activeCompleted = 0;
		let backgroundInFlight = 0;
		let maxBackgroundInFlight = 0;
		let releaseBackground!: () => void;
		const backgroundGate = new Promise<void>((resolve) => {
			releaseBackground = resolve;
		});

		const operation = refreshTabsForUpgrade([
			{ id: 3, active: false },
			{ id: 1, active: true },
			{ active: false },
			{ id: 4, active: false },
			{ id: 2, active: true },
			...backgroundIds.slice(2).map((id) => ({ id, active: false })),
		], async (tabId) => {
			visited.push(tabId);
			if (activeIds.includes(tabId)) {
				await Promise.resolve();
				activeCompleted += 1;
				return;
			}
			expect(activeCompleted).toBe(activeIds.length);
			backgroundInFlight += 1;
			maxBackgroundInFlight = Math.max(maxBackgroundInFlight, backgroundInFlight);
			await backgroundGate;
			backgroundInFlight -= 1;
		});

		await waitFor(() => backgroundInFlight === WARM_UPDATE_CONCURRENCY);
		expect(maxBackgroundInFlight).toBe(WARM_UPDATE_CONCURRENCY);
		expect(visited.slice(0, activeIds.length).sort((left, right) => left - right)).toEqual(activeIds);
		releaseBackground();
		await operation;
		expect([...visited].sort((left, right) => left - right)).toEqual([...activeIds, ...backgroundIds]);
	});

	test('continues the awaited queue after one tab injection rejects', async () => {
		const visited: number[] = [];
		await refreshTabsForUpgrade([
			{ id: 11, active: false },
			{ id: 12, active: false },
			{ id: 13, active: false },
			{ id: 14, active: false },
			{ id: 15, active: false },
		], async (tabId) => {
			visited.push(tabId);
			if (tabId === 12) throw new Error('tab closed during update');
		});
		expect([...visited].sort((left, right) => left - right)).toEqual([11, 12, 13, 14, 15]);
	});
});

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}
