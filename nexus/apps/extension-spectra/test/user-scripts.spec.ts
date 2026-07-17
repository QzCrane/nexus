import { afterEach, describe, expect, mock, test } from 'bun:test';
import { executeUserScriptInTab } from '../src/background/handlers/user-scripts';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('lazy USER_SCRIPT sandbox execution', () => {
	test('validates before Chrome access and retries a failed lazy world configuration', async () => {
		const getScripts = mock(async () => []);
		let configureAttempts = 0;
		const configureWorld = mock(async () => {
			configureAttempts += 1;
			if (configureAttempts === 1) throw new Error('world unavailable');
		});
		const getFrame = mock(async () => ({ documentId: 'document-7' }));
		const execute = mock(async () => [{ documentId: 'document-7' }]);
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				userScripts: { getScripts, configureWorld, execute },
				webNavigation: { getFrame },
			},
		});

		expect(await executeUserScriptInTab(7, 'document-7', '')).toEqual({
			success: false,
			error: 'Invalid user script request',
		});
		expect(getScripts).not.toHaveBeenCalled();
		expect((await executeUserScriptInTab(7, 'document-7', 'globalThis.first = true')).success).toBe(false);
		expect(execute).not.toHaveBeenCalled();
		expect(await executeUserScriptInTab(7, 'document-7', 'globalThis.second = true')).toEqual({ success: true });
		expect(configureWorld).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(expect.objectContaining({
			target: { tabId: 7, documentIds: ['document-7'] },
		}));
	});

	test('fails closed at every document-bound execution checkpoint', async () => {
		const frameIds: string[] = [];
		const resultIds: string[] = [];
		const execute = mock(async () => [{ documentId: resultIds.shift() }]);
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				userScripts: {
					getScripts: async () => [],
					configureWorld: async () => undefined,
					execute,
				},
				webNavigation: {
					getFrame: async () => ({ documentId: frameIds.shift() }),
				},
			},
		});

		frameIds.push('document-new');
		expect(await executeUserScriptInTab(7, 'document-7', 'globalThis.before = true'))
			.toEqual({ success: false, error: 'User script target document is stale' });
		expect(execute).not.toHaveBeenCalled();

		frameIds.push('document-7');
		resultIds.push('document-other');
		expect(await executeUserScriptInTab(7, 'document-7', 'globalThis.result = true'))
			.toEqual({ success: false, error: 'User script result came from a stale document' });

		frameIds.push('document-7', 'document-new');
		resultIds.push('document-7');
		expect(await executeUserScriptInTab(7, 'document-7', 'globalThis.after = true'))
			.toEqual({ success: false, error: 'User script document navigated before acknowledgement' });
	});
});
