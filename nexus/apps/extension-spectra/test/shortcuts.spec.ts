import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	runWithShortcutRuntime,
	resolveDirectCommand,
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
});
