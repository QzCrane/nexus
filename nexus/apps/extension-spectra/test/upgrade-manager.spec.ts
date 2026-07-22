import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	injectContentScriptOnDemand,
	performWarmUpdate,
	refreshTabsForUpgrade,
	WARM_UPDATE_CONCURRENCY,
} from '../src/background/upgrade-manager';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) {
		Object.defineProperty(globalThis, 'chrome', originalChrome);
		return;
	}
	Reflect.deleteProperty(globalThis, 'chrome');
});

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

	test('injects both MAIN-world bridges before the content bootstrap during warm update', async () => {
		const executeScript = mock(async (details: chrome.scripting.ScriptInjection) => {
			if ('func' in details) return [{ frameId: 0, result: false }];
			return [{ frameId: 0 }];
		});
		installChrome(executeScript);

		await performWarmUpdate();

		expect(executeScript.mock.calls.map(([details]) => (
			'files' in details ? { files: details.files, world: details.world } : { probe: true }
		))).toEqual([
			{ probe: true },
			{ files: ['content-fullscreen-bridge.js'], world: 'MAIN' },
			{ files: ['content-page-media-bridge.js'], world: 'MAIN' },
			{ files: ['content-bootstrap.js'], world: 'ISOLATED' },
		]);
	});

	test('injects both versioned MAIN bridges on the popup on-demand recovery path', async () => {
		const executeScript = mock(async () => [{ frameId: 0 }]);
		installChrome(executeScript);

		expect(await injectContentScriptOnDemand(21)).toBe(true);
		expect(executeScript.mock.calls.map(([details]) => ({
			files: details.files,
			world: details.world,
		}))).toEqual([
			{ files: ['content-fullscreen-bridge.js'], world: 'MAIN' },
			{ files: ['content-page-media-bridge.js'], world: 'MAIN' },
			{ files: ['content-bootstrap.js'], world: 'ISOLATED' },
		]);
	});
});

function installChrome(executeScript: ReturnType<typeof mock>): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			scripting: { executeScript },
			tabs: {
				query: async () => [{ id: 7, active: true }],
			},
		},
	});
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}
