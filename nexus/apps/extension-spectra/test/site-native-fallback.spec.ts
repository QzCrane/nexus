import { afterEach, describe, expect, mock, test } from 'bun:test';
import { applyMainSiteControl } from '../src/background/main-runtime-manager';

interface Harness {
	documentId: string;
	url: string;
	executeScript: ReturnType<typeof mock>;
}

function installHarness(): Harness {
	const harness: Harness = {
		documentId: 'document-youtube',
		url: 'https://www.youtube.com/watch?v=test',
		executeScript: mock(async () => [{
			documentId: 'document-youtube',
			frameId: 0,
			result: { ok: true, before: 1, actual: 1.5 },
		}]),
	};
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			webNavigation: {
				getFrame: async () => ({ documentId: harness.documentId, url: harness.url }),
			},
			scripting: { executeScript: harness.executeScript },
		},
	});
	return harness;
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('allowlisted one-shot site-native fallback', () => {
	test('runs one official setter/getter invocation in MAIN and returns privileged readback', async () => {
		const harness = installHarness();
		const result = await applyMainSiteControl({
			tabId: 7,
			documentId: 'document-youtube',
			generation: 3,
			intentId: 'intent-speed',
			field: 'speed',
			value: 1.5,
		});

		expect(result).toEqual({ adapter: 'youtube', field: 'speed', before: 1, actual: 1.5 });
		expect(harness.executeScript).toHaveBeenCalledTimes(1);
		expect(harness.executeScript.mock.calls[0]?.[0]).toMatchObject({
			target: { tabId: 7, documentIds: ['document-youtube'] },
			world: 'MAIN',
			args: ['speed', 1.5],
		});
	});

	test('rejects stale documents and non-allowlisted hosts before MAIN execution', async () => {
		const harness = installHarness();
		harness.documentId = 'document-new';
		await expect(applyMainSiteControl({
			tabId: 7,
			documentId: 'document-old',
			generation: 3,
			intentId: 'intent-stale',
			field: 'speed',
			value: 1.5,
		})).rejects.toThrow('stale document');

		harness.documentId = 'document-other';
		harness.url = 'https://youtube.com.evil.example/watch';
		await expect(applyMainSiteControl({
			tabId: 7,
			documentId: 'document-other',
			generation: 3,
			intentId: 'intent-host',
			field: 'speed',
			value: 1.5,
		})).rejects.toThrow('No allowlisted');
		expect(harness.executeScript).not.toHaveBeenCalled();
	});

	test('rejects malformed or mismatched official API readback', async () => {
		const harness = installHarness();
		harness.executeScript.mockImplementation(async () => [{
			documentId: 'document-youtube',
			frameId: 0,
			result: { ok: true, before: 1, actual: 99 },
		}]);
		await expect(applyMainSiteControl({
			tabId: 7,
			documentId: 'document-youtube',
			generation: 3,
			intentId: 'intent-invalid',
			field: 'speed',
			value: 1.5,
		})).rejects.toThrow('invalid readback');
	});
});
