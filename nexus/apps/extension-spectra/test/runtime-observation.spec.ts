import { afterEach, describe, expect, test } from 'bun:test';
import type { ContentRuntimeReadyResult } from '@nexus/contracts';
import { bindRuntimeObservationPort } from '../src/background/runtime-observation';
import { RUNTIME_OBSERVATION_PORT } from '../src/shared/runtime-observation';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const dispose of cleanups.splice(0)) dispose();
	if (prior) Object.defineProperty(globalThis, 'chrome', prior);
	else Reflect.deleteProperty(globalThis, 'chrome');
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(senderUrl = 'chrome-extension://spectra/popup.html', rejects = false) {
	Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
		runtime: { id: 'spectra', getURL: (path: string) => `chrome-extension://spectra/${path}` },
	} });
	const messages = new Set<(value: unknown) => void>();
	const disconnects = new Set<() => void>();
	const replies: unknown[] = [];
	const ensured: unknown[][] = [];
	const released: unknown[][] = [];
	let resolve!: (value: ContentRuntimeReadyResult) => void;
	let reject!: (error: Error) => void;
	const pending = new Promise<ContentRuntimeReadyResult>((accept, fail) => { resolve = accept; reject = fail; });
	let disconnected = false;
	const disconnect = (): void => {
		disconnected = true;
		for (const listener of [...disconnects]) listener();
	};
	const port = { name: RUNTIME_OBSERVATION_PORT, sender: { id: 'spectra', url: senderUrl },
		onMessage: { addListener: (fn: (value: unknown) => void) => messages.add(fn), removeListener: (fn: (value: unknown) => void) => messages.delete(fn) },
		onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
		postMessage: (value: unknown) => { if (rejects) throw new Error('Port target is gone'); replies.push(value); },
		disconnect,
	} as unknown as chrome.runtime.Port;
	bindRuntimeObservationPort(port, {
		ensure: async (...args) => { ensured.push(args); return pending; },
		release: (...args) => { released.push(args); },
	});
	cleanups.push(disconnect);
	const request = (reason = 'observation', tabId = 7): void => {
		for (const listener of [...messages]) listener({ protocolVersion: 2, requestId: 'observe-1',
			type: 'spectra.content.runtime.ensure', payload: { tabId, documentId: 'document-7', reason, capability: 'client-chosen' } });
	};
	return { request, disconnect, replies, ensured, released, messages, disconnects,
		resolve: () => resolve({ documentId: 'document-7', runtimeRevision: '3.4.0' }), reject,
		disconnected: () => disconnected };
}

describe('browser-owned Popup observation lifetime', () => {
	test('releases an acknowledged lease exactly once without a final UI message', async () => {
		const f = fixture(); f.request(); f.resolve(); await flush();
		expect(f.replies).toHaveLength(1); expect(f.released).toHaveLength(0);
		f.disconnect(); f.disconnect();
		expect(f.released).toEqual([[7, 'document-7', 'observation', f.ensured[0]?.[3]]]);
		expect(f.messages.size).toBe(0); expect(f.disconnects.size).toBe(0);
	});
	test('retires late acquisition after the Popup has already vanished', async () => {
		const f = fixture(); f.request(); f.disconnect(); f.resolve(); await flush();
		expect(f.released).toHaveLength(1); expect(f.replies).toHaveLength(0);
	});
	test('does not let a website sender or a mutation borrow observation admission', () => {
		const page = fixture('https://media.example/popup.html'); page.request();
		expect(page.disconnected()).toBe(true); expect(page.ensured).toHaveLength(0);
		const mutation = fixture(); mutation.request('control');
		expect(mutation.disconnected()).toBe(true); expect(mutation.ensured).toHaveLength(0);
		const malformed = fixture(); malformed.request('observation', -1);
		expect(malformed.disconnected()).toBe(true); expect(malformed.ensured).toHaveLength(0);
	});
	test('rejects a second acquisition on the same port and retires the first late result', async () => {
		const f = fixture(); f.request(); f.request(); f.resolve(); await flush();
		expect(f.ensured).toHaveLength(1); expect(f.released).toHaveLength(1);
		expect(f.disconnected()).toBe(true); expect(f.replies).toHaveLength(0);
	});
	test('mints independent capabilities even when clients supply identical names', () => {
		const a = fixture(); const b = fixture(); a.request(); b.request();
		expect(a.ensured[0]?.[3]).not.toBe(b.ensured[0]?.[3]);
		expect(a.ensured[0]?.[3]).not.toBe('client-chosen');
	});
	test('releases when an acknowledgement cannot be delivered', async () => {
		const f = fixture(undefined, true); f.request(); f.resolve(); await flush();
		expect(f.disconnected()).toBe(true); expect(f.released).toHaveLength(1);
	});
	test('reports acquisition failure and does not retain a dead port', async () => {
		const f = fixture(); f.request(); f.reject(new Error('stale document')); await flush();
		expect(f.replies).toMatchObject([{ ok: false, error: { code: 'observation_unavailable' } }]);
		expect(f.disconnected()).toBe(true); expect(f.released).toHaveLength(0);
	});
});
