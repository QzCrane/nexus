import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	releasePageGestureBurst,
	resolveChromeCommandAction,
	runPageGestureBurst,
	runChromeCommandSingleFlight,
	runWithShortcutRuntime,
	waitForPageGestureBurst,
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

describe('cold-document shortcuts', () => {
	test('reserves one browser-invoked volume-up command and keeps the other defaults page-owned', () => {
		const pageCommands = ['speed_down', 'speed_up', 'volume_down', 'volume_mute', 'toggle_mute'];
		const manifest = JSON.parse(readFileSync(
			resolve(import.meta.dir, '../public/manifest.json'),
			'utf8',
		)) as {
			commands: Record<string, {
				suggested_key?: { default?: string; mac?: string };
				description?: string;
			}>;
		};
		for (const command of pageCommands) expect(manifest.commands[command]).toBeUndefined();
		expect(manifest.commands.volume_up).toMatchObject({
			suggested_key: { default: 'Alt+Up' },
		});
		expect(Object.values(manifest.commands).filter(({ suggested_key }) => suggested_key)).toHaveLength(1);
		expect(resolveChromeCommandAction('volume_up')).toBe('volume_up');
	});

	test('admits only identity-bound extension shortcut routes and keeps site-page sender-bound', () => {
		const source = readFileSync(resolve(import.meta.dir, '../src/background/shortcuts.ts'), 'utf8');
		expect(source).toContain('submitExtensionInvokedControlRequest');
		expect(source).toContain('submitExtensionInvokedControlOperation');
		expect(source).not.toContain('submitControlRequest');
		expect(source).not.toContain('extensionInvoked');
		expect(source).toContain('defaultHotkeySenderIdentity');
		expect(source).toContain('route.invocation.target.documentId');
		expect(source).toContain('validateHotkeyDocument');
		expect(source).toContain('frame.documentId !== identity.documentId');
		expect(source).not.toContain('before.url !== identity.url');
		expect(source).toContain('{ ...identity.tab, url: before.url }');
		expect(source).toContain("'builtin-page'");
		expect(source).toContain("'chrome-command'");
		expect(source).toContain("origin: 'site-page'");
		expect(source).toContain("message.payload.disposition === 'site-page'");
		expect(source).toContain('runSitePageHotkey');
		expect(source).toContain('runDefaultPageHotkey');
		expect(source).toContain('activeChromeCommands.has(command)');
		expect(source).toContain('activeChromeCommands.delete(command)');
		expect(source).not.toMatch(/\bsubmitControlOperation\(/u);

		const siteStart = source.indexOf('async function runSitePageHotkey');
		const routeStart = source.indexOf('interface ShortcutRoute', siteStart);
		const siteBlock = source.slice(siteStart, routeStart);
		expect(siteBlock).toContain('foreground: document');
		expect(siteBlock).toContain('target: document');
		expect(siteBlock).toContain('executeShortcutRoute');
		expect(siteBlock).not.toContain('hotkeyTargetRepository');

		const defaultStart = source.indexOf('async function runDefaultPageHotkey');
		const siteFunctionStart = source.indexOf('async function runSitePageHotkey', defaultStart);
		const defaultBlock = source.slice(defaultStart, siteFunctionStart);
		expect(defaultBlock).toContain('resolveShortcutTargetFromActive');
		expect(source).toContain('const { tabId: targetId } = await hotkeyTargetRepository.get();');
	});

	test('acquires a document runtime before executing and releases it afterwards', async () => {
		const port = runtimePort();
		const order: string[] = [];
		port.ensure.mockImplementation(async () => {
			order.push('ensure');
			return { documentId: 'document-cold' };
		});
		port.release.mockImplementation(() => { order.push('release'); });

		const result = await runWithShortcutRuntime(17, 'document-cold', async (documentId) => {
			expect(documentId).toBe('document-cold');
			order.push('execute');
			return 'applied';
		}, port);

		expect(result).toBe('applied');
		expect(order).toEqual(['ensure', 'execute', 'release']);
		expect(port.ensure.mock.calls[0]?.[0]).toBe(17);
		expect(port.release.mock.calls[0]?.slice(0, 2)).toEqual([17, 'document-cold']);
		expect(port.ensure.mock.calls[0]?.slice(0, 2)).toEqual([17, 'document-cold']);
		expect(port.release.mock.calls[0]?.[2]).toBe(port.ensure.mock.calls[0]?.[2]);
	});

	test('releases the transient runtime when the shortcut action fails', async () => {
		const port = runtimePort();
		await expect(runWithShortcutRuntime(17, 'document-cold', async () => {
			throw new Error('mute readback mismatch');
		}, port)).rejects.toThrow('mute readback mismatch');
		expect(port.release).toHaveBeenCalledTimes(1);
	});

	test('rejects a READY handshake for another document before invoking the writer', async () => {
		const port = runtimePort();
		port.ensure.mockResolvedValue({ documentId: 'document-new' });
		let executed = false;
		await expect(runWithShortcutRuntime(17, 'document-old', async () => {
			executed = true;
		}, port)).rejects.toThrow('stale target document');
		expect(executed).toBe(false);
		expect(port.release).toHaveBeenCalledTimes(1);
	});

	test('drops held-command repeats without retaining a trailing invocation', async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolveFirst) => {
			releaseFirst = resolveFirst;
		});
		let executions = 0;
		const first = runChromeCommandSingleFlight('play_pause', async () => {
			executions += 1;
			await firstBlocked;
		});

		const repeats = await Promise.all([
			runChromeCommandSingleFlight('play_pause', async () => { executions += 1; }),
			runChromeCommandSingleFlight('play_pause', async () => { executions += 1; }),
		]);
		expect(repeats).toEqual([false, false]);
		expect(executions).toBe(1);

		releaseFirst();
		expect(await first).toBe(true);
		expect(executions).toBe(1);
		expect(await runChromeCommandSingleFlight(
			'play_pause',
			async () => { executions += 1; },
		)).toBe(true);
		expect(executions).toBe(2);
	});

	test('releases the held-command gate after failure', async () => {
		await expect(runChromeCommandSingleFlight('open_options', async () => {
			throw new Error('failed');
		})).rejects.toThrow('failed');
		expect(await runChromeCommandSingleFlight('open_options', async () => undefined)).toBe(true);
	});

	test('coalesces slow page repeats only when a new physical pulse arrives', async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolveFirst) => {
			releaseFirst = resolveFirst;
		});
		const key = 'page:17:document:volume_down:default:7';
		const batches: number[] = [];
		const first = runPageGestureBurst(key, async (pulses) => {
			batches.push(pulses);
			await firstBlocked;
		});
		expect(await runPageGestureBurst(key, async (pulses) => {
			batches.push(pulses);
		})).toBe(false);
		expect(await runPageGestureBurst(key, async (pulses) => {
			batches.push(pulses);
		})).toBe(false);

		releaseFirst();
		expect(await first).toBe(true);
		expect(batches).toEqual([1]);

		expect(await runPageGestureBurst(key, async (pulses) => {
			batches.push(pulses);
		})).toBe(true);
		expect(batches).toEqual([1, 3]);
	});

	test('drops accumulated page pulses immediately on physical release', async () => {
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolveFirst) => {
			releaseFirst = resolveFirst;
		});
		const batches: number[] = [];
		const first = runPageGestureBurst('page:17:document:speed_down', async (pulses) => {
			batches.push(pulses);
			await firstBlocked;
		});
		expect(await runPageGestureBurst(
			'page:17:document:speed_down',
			async (pulses) => { batches.push(pulses); },
		)).toBe(false);
		releasePageGestureBurst('page:17:document:speed_down');
		releaseFirst();
		expect(await first).toBe(true);
		expect(batches).toEqual([1]);

		expect(await runPageGestureBurst(
			'page:17:document:speed_down',
			async (pulses) => { batches.push(pulses); },
		)).toBe(true);
		expect(batches).toEqual([1, 1]);
	});

	test('keeps the admitted first press through cold runtime startup while release drops repeats', async () => {
		let releaseRuntime!: () => void;
		const runtimeReady = new Promise<void>((resolveRuntime) => {
			releaseRuntime = resolveRuntime;
		});
		const port = runtimePort();
		port.ensure.mockImplementation(async () => {
			await runtimeReady;
			return { documentId: 'document-cold' };
		});
		const key = 'page:17:document:speed_up:default:7';
		let writerCalls = 0;
		const execution = runPageGestureBurst(key, async () => {
			await runWithShortcutRuntime(17, 'document-cold', async () => {
				writerCalls += 1;
			}, port);
		});
		expect(await runPageGestureBurst(key, async () => {
			writerCalls += 1;
		})).toBe(false);
		releasePageGestureBurst(key);
		let settled = false;
		const waiting = waitForPageGestureBurst(key).then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		releaseRuntime();
		expect(await execution).toBe(true);
		await waiting;
		expect(settled).toBe(true);
		expect(writerCalls).toBe(1);
		expect(port.release).toHaveBeenCalledTimes(1);
	});
});