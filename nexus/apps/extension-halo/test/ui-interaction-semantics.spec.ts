import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	resolveCommandPaletteKeyAction,
} from '../src/components/legacy/command-palette-keyboard';
import { DockItem } from '../src/components/sidepanel/DockItem';
import {
	mergeInitialActiveServiceStorageState,
	type ActiveServiceStorageState,
} from '../src/components/sidepanel/ActiveServicesContext';
import type { ToolMeta } from '../src/kernel';
import {
	createUserScriptsStateLoader,
} from '../src/system/userscripts/hooks/user-scripts-state-loader';
import type { UserScriptState } from '../src/system/userscripts/types';
import {
	createOwnedClipboardCopyController,
} from '../src/kernel/hooks/use-owned-clipboard-copy';
import {
	createSerializedAsyncPoller,
} from '../src/kernel/utils/serialized-async-poller';

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

describe('UserScripts async lifecycle', () => {
	test('commits only the latest mounted load and handles read rejection', async () => {
		const first = createDeferred<UserScriptState>();
		const second = createDeferred<UserScriptState>();
		const staleFailure = createDeferred<UserScriptState>();
		const replacement = createDeferred<UserScriptState>();
		const rejected = createDeferred<UserScriptState>();
		const afterDispose = createDeferred<UserScriptState>();
		const pendingReads = [
			first,
			second,
			staleFailure,
			replacement,
			rejected,
			afterDispose,
		];
		const committed: UserScriptState[] = [];
		const errors: unknown[] = [];
		const loader = createUserScriptsStateLoader(
			() => {
				const pendingRead = pendingReads.shift();
				if (!pendingRead) return Promise.reject(new Error('No pending read'));
				return pendingRead.promise;
			},
			(state) => committed.push(state),
			(error) => errors.push(error),
		);

		loader.activate();
		const firstLoad = loader.load();
		const secondLoad = loader.load();
		const newestState = { scripts: [], globalEnabled: false };
		second.resolve(newestState);
		await secondLoad;
		first.resolve({ scripts: [], globalEnabled: true });
		await firstLoad;

		expect(committed).toEqual([newestState]);

		const staleLoad = loader.load();
		const replacementLoad = loader.load();
		staleFailure.reject(new Error('superseded read failed'));
		replacement.resolve(newestState);
		await Promise.all([staleLoad, replacementLoad]);
		expect(committed).toEqual([newestState, newestState]);
		expect(errors).toEqual([]);

		const failedLoad = loader.load();
		const failure = new Error('storage unavailable');
		rejected.reject(failure);
		await expect(failedLoad).resolves.toBeUndefined();
		expect(errors).toEqual([failure]);

		const disposedLoad = loader.load();
		loader.dispose();
		afterDispose.resolve({ scripts: [], globalEnabled: true });
		await disposedLoad;
		expect(committed).toEqual([newestState, newestState]);
	});
});

describe('shared async lifecycle owners', () => {
	test('merges initial runtime status without overwriting event-owned fields', () => {
		const current: ActiveServiceStorageState = {
			ready: false,
			clipboardEnabled: false,
			hoverZoomEnabled: false,
			userscriptsEnabled: false,
			smoothScrollEnabled: true,
			userScripts: [{ id: 'live-script', enabled: true }],
			saatScripts: [],
		};
		const initial: ActiveServiceStorageState = {
			ready: true,
			clipboardEnabled: true,
			hoverZoomEnabled: true,
			userscriptsEnabled: true,
			smoothScrollEnabled: false,
			userScripts: [{ id: 'stale-script', enabled: false }],
			saatScripts: [{ id: 'saat', enabled: true, saatToolId: 'tool' }],
		};

		expect(mergeInitialActiveServiceStorageState(
			current,
			initial,
			new Set(['smoothScrollEnabled', 'userScripts']),
		)).toEqual({
			ready: true,
			clipboardEnabled: true,
			hoverZoomEnabled: true,
			userscriptsEnabled: true,
			smoothScrollEnabled: true,
			userScripts: [{ id: 'live-script', enabled: true }],
			saatScripts: [{ id: 'saat', enabled: true, saatToolId: 'tool' }],
		});
	});

	test('commits only the latest clipboard write and owns its reset timer', async () => {
		const first = createDeferred<void>();
		const second = createDeferred<void>();
		const writes = [first, second];
		const successes: string[] = [];
		const failures: unknown[] = [];
		let resetCount = 0;
		let scheduledReset: (() => void) | null = null;
		let clearedTimers = 0;
		const controller = createOwnedClipboardCopyController<string>({
			clearTimer: () => {
				clearedTimers++;
				scheduledReset = null;
			},
			schedule: (callback) => {
				scheduledReset = callback;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			writeText: () => {
				const write = writes.shift();
				if (!write) return Promise.reject(new Error('No pending write'));
				return write.promise;
			},
		});
		const callbacks = {
			onFailure: (error: unknown) => failures.push(error),
			onReset: () => {
				resetCount++;
			},
			onSuccess: (key: string) => successes.push(key),
		};

		controller.activate();
		const firstCopy = controller.copy('first', 'a', callbacks, 1500);
		const secondCopy = controller.copy('second', 'b', callbacks, 1500);
		second.resolve();
		expect(await secondCopy).toBe(true);
		first.resolve();
		expect(await firstCopy).toBe(false);
		expect(successes).toEqual(['second']);
		expect(failures).toEqual([]);

		scheduledReset?.();
		expect(resetCount).toBe(1);

		const rejected = controller.copy('third', 'c', callbacks, 1500);
		expect(await rejected).toBe(false);
		expect(failures).toHaveLength(1);
		controller.dispose();
		expect(clearedTimers).toBe(0);
	});

	test('serializes polling and rejects stale work after stop or disposal', async () => {
		const first = createDeferred<number>();
		const stale = createDeferred<number>();
		const latest = createDeferred<number>();
		const reads = [first, stale, latest];
		const committed: number[] = [];
		const errors: unknown[] = [];
		let activeReads = 0;
		let maxActiveReads = 0;
		let scheduledRun: (() => void) | null = null;
		const poller = createSerializedAsyncPoller(
			async () => {
				activeReads++;
				maxActiveReads = Math.max(maxActiveReads, activeReads);
				const read = reads.shift();
				if (!read) throw new Error('No pending read');
				try {
					return await read.promise;
				} finally {
					activeReads--;
				}
			},
			(value) => committed.push(value),
			(error) => errors.push(error),
			1000,
			{
				clearTimer: () => {
					scheduledRun = null;
				},
				schedule: (callback) => {
					scheduledRun = callback;
					return 1 as unknown as ReturnType<typeof setTimeout>;
				},
			},
		);

		poller.start();
		poller.trigger();
		expect(activeReads).toBe(1);
		first.resolve(1);
		await first.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(committed).toEqual([1]);
		expect(activeReads).toBe(1);

		poller.stop();
		poller.start();
		stale.resolve(2);
		await stale.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(committed).toEqual([1]);
		expect(activeReads).toBe(1);

		latest.resolve(3);
		await latest.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(committed).toEqual([1, 3]);
		expect(maxActiveReads).toBe(1);
		expect(errors).toEqual([]);
		expect(scheduledRun).not.toBeNull();

		poller.dispose();
		expect(scheduledRun).toBeNull();
	});
});

describe('Dock item interaction ownership', () => {
	test('renders primary and close as separate keyboard-reachable buttons', () => {
		const tool = {
			id: 'demo',
			icon: '🧪',
			pluginType: 'tool',
			category: 'dev',
			builtIn: true,
			keywords: [],
		} as ToolMeta;
		const markup = renderToStaticMarkup(createElement(DockItem, {
			tool,
			label: 'Demo',
			closeLabel: 'Close',
			isActive: false,
			scale: 1,
			baseSize: 38,
			onMouseEnter: () => {},
			onMouseLeave: () => {},
			onClick: () => {},
			onClose: () => {},
		}));

		expect(markup).toContain('data-dock-item="true"');
		expect(markup.match(/<button\b/gu)).toHaveLength(2);
		expect(markup).toContain('aria-label="Demo"');
		expect(markup).toContain('aria-label="Close: Demo"');
		expect(markup).not.toContain('role="button"');
	});
});

describe('Command Palette keyboard ownership', () => {
	test('uses activeIndex Enter only when the search input owns the key event', () => {
		expect(resolveCommandPaletteKeyAction('Enter', true)).toBe('select-active');
		expect(resolveCommandPaletteKeyAction('Enter', false)).toBeNull();
		expect(resolveCommandPaletteKeyAction('ArrowDown', false)).toBe('next');
		expect(resolveCommandPaletteKeyAction('Escape', false)).toBe('close');
	});
});
