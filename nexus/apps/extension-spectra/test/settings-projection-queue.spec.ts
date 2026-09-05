import { describe, expect, test } from 'bun:test';
import { SettingsProjectionQueue } from '../src/background/settings-projection-queue';
import { isExpectedAbsentContentReceiver } from '../src/background/settings-projection';

interface Snapshot {
	revision: number;
}

describe('settings projection queue', () => {
	test('retries real delivery failures but lets non-resident documents pull on bootstrap', () => {
		for (const message of [
			'Could not establish connection. Receiving end does not exist.',
			'The tab was closed.',
			'No tab with id: 7.',
			'Cannot access contents of url "chrome://settings".',
		]) {
			expect(isExpectedAbsentContentReceiver(new Error(message))).toBe(true);
		}
		expect(isExpectedAbsentContentReceiver(new Error('Transient IPC transport failure'))).toBe(false);
	});

	test('coalesces later revisions and preserves every required projection lane', async () => {
		const runs: Array<{
			revision: number;
			global: boolean;
			hotkeys: boolean;
			mediaRouteDomains: string[];
			mediaRoutesAll: boolean;
		}> = [];
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const queue = new SettingsProjectionQueue<Snapshot>({
			project: async (work) => {
				runs.push({
					revision: work.snapshot.revision,
					global: work.global,
					hotkeys: work.hotkeys,
					mediaRouteDomains: work.mediaRouteDomains,
					mediaRoutesAll: work.mediaRoutesAll,
				});
				if (work.snapshot.revision === 1) await firstBlocked;
			},
			onSuccess: () => undefined,
			onDeferred: () => undefined,
			delay: async () => undefined,
		});

		queue.enqueue({
			snapshot: { revision: 1 },
			global: true,
			hotkeys: false,
			mediaRouteDomains: ['video.example.com'],
			mediaRoutesAll: false,
		});
		await Promise.resolve();
		queue.enqueue({
			snapshot: { revision: 2 },
			global: false,
			hotkeys: true,
			mediaRouteDomains: ['audio.example.com'],
			mediaRoutesAll: false,
		});
		queue.enqueue({
			snapshot: { revision: 3 },
			global: true,
			hotkeys: false,
			mediaRouteDomains: [],
			mediaRoutesAll: true,
		});
		releaseFirst();
		await queue.whenIdle();

		expect(runs).toEqual([
			{
				revision: 1,
				global: true,
				hotkeys: false,
				mediaRouteDomains: ['video.example.com'],
				mediaRoutesAll: false,
			},
			{
				revision: 3,
				global: true,
				hotkeys: true,
				mediaRouteDomains: ['audio.example.com'],
				mediaRoutesAll: true,
			},
		]);
	});

	test('bounds immediate retries and keeps failed work for an alarm wake', async () => {
		let attempts = 0;
		let deferredRevision = -1;
		let shouldFail = true;
		const queue = new SettingsProjectionQueue<Snapshot>({
			project: async () => {
				attempts += 1;
				if (shouldFail) throw new Error('runner unavailable');
			},
			onSuccess: () => undefined,
			onDeferred: (work) => { deferredRevision = work.snapshot.revision; },
			delay: async () => undefined,
			retryDelaysMs: [1, 2],
		});

		queue.enqueue({
			snapshot: { revision: 4 },
			global: true,
			hotkeys: true,
			mediaRouteDomains: [],
			mediaRoutesAll: true,
		});
		await queue.whenIdle();
		expect(attempts).toBe(3);
		expect(deferredRevision).toBe(4);

		shouldFail = false;
		queue.wake();
		await queue.whenIdle();
		expect(attempts).toBe(4);
	});
});
