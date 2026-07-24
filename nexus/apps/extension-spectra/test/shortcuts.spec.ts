import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	resolveDirectCommand,
	runChromeCommandSingleFlight,
	runWithShortcutRuntime,
	type ShortcutRuntimePort,
} from '../src/background/shortcuts';

function runtimePort(): ShortcutRuntimePort & {
	ensure: ReturnType<typeof mock>;
	release: ReturnType<typeof mock>;
} {
	return {
		ensure: mock(async () => ({ documentId: 'document-cold' })),
		release: mock(() => undefined),
	};
}

describe('cold-document Chrome shortcuts', () => {
	test('maps the Manifest mute command through the shared command contract', () => {
		expect(resolveDirectCommand('toggle_mute')).toBe('volume_mute');
	});
	test('uses the Background-invoked coordinator path instead of page-hotkey admission', () => {
		const source = readFileSync(resolve(import.meta.dir, '../src/background/shortcuts.ts'), 'utf8');
		expect(source).toContain('submitExtensionInvokedControlRequest');
		expect(source).toContain('submitExtensionInvokedControlOperation');
		expect(source).toContain('activeChromeCommands.has(command)');
		expect(source).toContain('activeChromeCommands.delete(command)');
		expect(source).not.toMatch(/\bsubmitControlRequest\(/u);
		expect(source).not.toMatch(/\bsubmitControlOperation\(/u);
	});

	test('acquires a document runtime before executing and releases it afterwards', async () => {
		const port = runtimePort();
		const order: string[] = [];
		port.ensure.mockImplementation(async () => {
			order.push('ensure');
			return { documentId: 'document-cold' };
		});
		port.release.mockImplementation(() => { order.push('release'); });

		const result = await runWithShortcutRuntime(17, async () => {
			order.push('execute');
			return 'applied';
		}, port);

		expect(result).toBe('applied');
		expect(order).toEqual(['ensure', 'execute', 'release']);
		expect(port.ensure.mock.calls[0]?.[0]).toBe(17);
		expect(port.release.mock.calls[0]?.slice(0, 2)).toEqual([17, 'document-cold']);
		expect(port.release.mock.calls[0]?.[2]).toBe(port.ensure.mock.calls[0]?.[1]);
	});

	test('releases the transient runtime when the shortcut action fails', async () => {
		const port = runtimePort();
		await expect(runWithShortcutRuntime(17, async () => {
			throw new Error('mute readback mismatch');
		}, port)).rejects.toThrow('mute readback mismatch');
		expect(port.release).toHaveBeenCalledTimes(1);
	});

	test('drops held-command repeats without retaining a trailing invocation', async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolveFirst) => {
			releaseFirst = resolveFirst;
		});
		let executions = 0;
		const first = runChromeCommandSingleFlight('volume_up', async () => {
			executions += 1;
			await firstBlocked;
		});

		const repeats = await Promise.all([
			runChromeCommandSingleFlight('volume_up', async () => { executions += 1; }),
			runChromeCommandSingleFlight('volume_up', async () => { executions += 1; }),
		]);
		expect(repeats).toEqual([false, false]);
		expect(executions).toBe(1);

		releaseFirst();
		expect(await first).toBe(true);
		expect(executions).toBe(1);
		expect(await runChromeCommandSingleFlight(
			'volume_up',
			async () => { executions += 1; },
		)).toBe(true);
		expect(executions).toBe(2);
	});

	test('releases the held-command gate after failure', async () => {
		await expect(runChromeCommandSingleFlight('speed_up', async () => {
			throw new Error('failed');
		})).rejects.toThrow('failed');
		expect(await runChromeCommandSingleFlight('speed_up', async () => undefined)).toBe(true);
	});
});
