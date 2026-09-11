import { describe, expect, test } from 'bun:test';
import type { BrowserContext, Worker } from '@playwright/test';
import { runInNewContext } from 'node:vm';
import { extensionWorker } from './helpers/extension-worker';

const id = 'a'.repeat(32);
const url = `chrome-extension://${id}/background.js`;
const bindings = () => ({
	runtime: { id, sendMessage() {} },
	storage: { sync: { set() {} }, local: { set() {} } },
	tabs: { query() {} }, permissions: { getAll() {} },
});

function workerWith(read: () => unknown, address = url) {
	let evaluations = 0;
	const worker = {
		url: () => address,
		evaluate: async (probe: (expected: string) => boolean, expected: string) => {
			evaluations += 1;
			return runInNewContext(`(${probe.toString()})(expected)`, { chrome: read(), expected });
		},
	} as unknown as Worker;
	return { worker, count: () => evaluations };
}

function contextWith(workers: Worker[], future?: Worker) {
	return {
		serviceWorkers: () => workers,
		waitForEvent: async (event: string, options: { predicate: (worker: Worker) => boolean }) => {
			expect(event).toBe('serviceworker');
			if (!future || !options.predicate(future)) throw new Error('No matching worker');
			return future;
		},
	} as unknown as BrowserContext;
}

describe('HALO extension worker readiness', () => {
	test('ignores website workers and waits for exact native extension bindings', async () => {
		const website = workerWith(bindings, 'https://example.test/background.js');
		let stage = 0;
		const extension = workerWith(() => [undefined, { runtime: { id } }, bindings()][Math.min(stage++, 2)]);
		expect(await extensionWorker(contextWith([website.worker, extension.worker]))).toBe(extension.worker);
		expect(website.count()).toBe(0);
		expect(extension.count()).toBe(3);
	});

	test('filters the future target event by exact extension background URL', async () => {
		const future = workerWith(bindings);
		expect(await extensionWorker(contextWith([], future.worker))).toBe(future.worker);
		const website = workerWith(bindings, 'https://example.test/background.js');
		await expect(extensionWorker(contextWith([], website.worker))).rejects.toThrow('No matching worker');
	});

	test('does not accept a different runtime identity or incomplete permissions and storage', async () => {
		for (const state of [
			{ ...bindings(), runtime: { id: 'b'.repeat(32), sendMessage() {} } },
			{ ...bindings(), storage: { local: { set() {} } } },
			{ ...bindings(), tabs: {} },
			{ ...bindings(), permissions: {} },
		]) {
			const endpoint = workerWith(() => state);
			await expect(extensionWorker(contextWith([endpoint.worker]), 5)).rejects.toThrow('bindings did not become ready');
			expect(endpoint.count()).toBeGreaterThan(0);
		}
	});

	test('propagates an actual execution failure instead of concealing it as startup delay', async () => {
		const endpoint = workerWith(() => { throw new Error('Execution context destroyed'); });
		await expect(extensionWorker(contextWith([endpoint.worker]))).rejects.toThrow('Execution context destroyed');
		expect(endpoint.count()).toBe(1);
	});
});
