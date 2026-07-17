import { afterEach, describe, expect, test } from 'bun:test';
import {
	isExtensionContextInvalidatedError,
	isExtensionContextValid,
	runWithValidExtensionContext,
} from '../src/content/core/extension-context';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

function installRuntime(runtime: object): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { runtime },
	});
}

describe('extension context retirement boundary', () => {
	test('retires before invoking Chrome when the context was invalidated', async () => {
		installRuntime({ get id(): string { throw new Error('Extension context invalidated.'); } });
		let calls = 0;
		let disposals = 0;
		expect(isExtensionContextValid()).toBe(false);
		expect(await runWithValidExtensionContext(async () => {
			calls += 1;
			return 'unexpected';
		}, () => { disposals += 1; })).toBeUndefined();
		expect({ calls, disposals }).toEqual({ calls: 0, disposals: 1 });
	});

	test('retires a synchronous sendMessage invalidation without an unhandled rejection', async () => {
		installRuntime({ id: 'spectra-test' });
		let disposals = 0;
		const result = await runWithValidExtensionContext(
			() => { throw new Error('Extension context invalidated.'); },
			() => { disposals += 1; },
		);
		expect(result).toBeUndefined();
		expect(disposals).toBe(1);
	});

	test('does not hide unrelated command or transport failures', async () => {
		installRuntime({ id: 'spectra-test' });
		const failure = new Error('Malformed extension command');
		expect(isExtensionContextInvalidatedError(failure)).toBe(false);
		expect(runWithValidExtensionContext(() => Promise.reject(failure))).rejects.toBe(failure);
	});
});
