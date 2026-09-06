import { afterEach, describe, expect, test } from 'bun:test';
import { installOptionalPermissionClickGate } from '../src/shared/optional-permission-click-gate';

const descriptors = new Map(['chrome', 'document', 'Element'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const disposers: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});
function deferred() {
	let resolve!: (value: boolean) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<boolean>((accept, fail) => { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup(request: () => Promise<boolean>, ownsIntent = () => true) {
	const listeners = new Set<(event: Event) => void>();
	const operations: string[] = [];
	let downstream: (() => void) | undefined;
	class Button {
		disabled = false;
		isConnected = true;
		private readonly attributes = new Map<string, string>();
		constructor(readonly id: string) {}
		closest() { return this; }
		getAttribute(name: string) { return this.attributes.get(name) ?? null; }
		setAttribute(name: string, value: string) { this.attributes.set(name, value); }
		removeAttribute(name: string) { this.attributes.delete(name); }
		click() {
			if (this.disabled) return;
			let stopped = false;
			const event = { target: this, preventDefault() {}, stopImmediatePropagation() { stopped = true; } } as unknown as Event;
			for (const listener of [...listeners]) { listener(event); if (stopped) break; }
			if (!stopped) { operations.push(this.id); downstream?.(); }
		}
	}
	for (const [key, value] of Object.entries({
		Element: Button,
		document: { addEventListener: (_: string, listener: (event: Event) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: Event) => void) => listeners.delete(listener) },
		chrome: { permissions: { request } },
	})) Object.defineProperty(globalThis, key, { value, configurable: true });
	const dispose = installOptionalPermissionClickGate({ selector: 'button', permission: 'downloads', captureIntent: () => ownsIntent });
	disposers.push(dispose);
	return { a: new Button('a'), b: new Button('b'), operations, dispose, setDownstream: (handler: () => void) => { downstream = handler; } };
}

describe('permission continuation ownership', () => {
	test('requests synchronously and blocks every matching second button until admission', async () => {
		const pending = deferred(); let calls = 0;
		const fixture = setup(() => { calls++; return pending.promise; });
		fixture.a.click();
		expect(calls).toBe(1);
		fixture.b.click();
		expect(fixture.operations).toEqual([]);
		pending.resolve(true); await flush();
		expect(fixture.operations).toEqual(['a']);
		expect(calls).toBe(1);
	});

	test('does not replay after disposal', async () => {
		const pending = deferred(); const fixture = setup(() => pending.promise);
		fixture.a.click(); fixture.dispose(); pending.resolve(true); await flush();
		expect(fixture.operations).toEqual([]);
		expect(fixture.a.getAttribute('aria-busy')).toBeNull();
	});

	test('does not replay a removed or retargeted operation', async () => {
		let current = true;
		const pending = deferred(); const fixture = setup(() => pending.promise, () => current);
		fixture.a.click(); current = false; pending.resolve(true); await flush();
		expect(fixture.operations).toEqual([]);
		const removed = deferred(); const next = setup(() => removed.promise);
		next.a.click(); next.a.isConnected = false; removed.resolve(true); await flush();
		expect(next.operations).toEqual([]);
	});

	test('consumes only one exact replay and blocks reentrant clicks on another button', async () => {
		const pending = deferred(); const fixture = setup(() => pending.promise);
		fixture.setDownstream(() => fixture.b.click());
		fixture.a.click(); pending.resolve(true); await flush();
		expect(fixture.operations).toEqual(['a']);
	});

	test('does not undo another owner disabling the button while the prompt is open', async () => {
		const pending = deferred(); const fixture = setup(() => pending.promise);
		fixture.a.setAttribute('aria-busy', 'false');
		fixture.a.click(); fixture.a.disabled = true; pending.resolve(true); await flush();
		expect(fixture.a.disabled).toBe(true);
		expect(fixture.a.getAttribute('aria-busy')).toBe('false');
		expect(fixture.operations).toEqual([]);
	});

	test('a denied request does not run business logic and can be retried', async () => {
		let calls = 0;
		const fixture = setup(async () => ++calls > 1);
		fixture.a.click(); await flush(); expect(fixture.operations).toEqual([]);
		fixture.a.click(); await flush(); expect(fixture.operations).toEqual(['a']);
	});

	test('a synchronous API failure cannot strand the gate', async () => {
		let calls = 0;
		const fixture = setup(() => { if (++calls === 1) throw new Error('API unavailable'); return Promise.resolve(true); });
		fixture.a.click(); fixture.a.click(); await flush();
		expect(fixture.operations).toEqual(['a']);
	});
});
