import { afterEach, describe, expect, test } from 'bun:test';
import { bindOptionsRetry, showOptionsError, clearOptionsError } from '../src/options/status';
import { createRevisionedSettingsClient } from '../src/shared/revisioned-settings-client';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('Options failure presentation', () => {
	test('publishes and clears one accessible page-level error surface', () => {
		const surface = { hidden: true };
		const message = { textContent: 'Settings are temporarily unavailable. Retry.' };
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementById: (id: string) => id === 'options-status' ? surface : id === 'options-status-message' ? message : null },
		});
		const originalError = console.error;
		const technicalErrors: unknown[][] = [];
		console.error = (...values: unknown[]) => { technicalErrors.push(values); };
		try {
			showOptionsError(new Error('worker restarting'));
			expect(surface.hidden).toBe(false);
			expect(message.textContent).toBe('Settings are temporarily unavailable. Retry.');
			expect(technicalErrors[0]?.[1]).toBeInstanceOf(Error);
			clearOptionsError();
			expect(surface.hidden).toBe(true);
			expect(message.textContent).toBe('Settings are temporarily unavailable. Retry.');
		} finally {
			console.error = originalError;
		}
	});

	test('leaves Options unhydrated when the authoritative settings read fails', async () => {
		let patchAttempts = 0;
		const client = createRevisionedSettingsClient<{ revision: number }, { enabled: boolean }>({
			getSnapshot: () => Promise.reject(new Error('worker restarting')),
			sendPatch: () => {
				patchAttempts += 1;
				return Promise.resolve({ ok: true, data: { revision: 1 } });
			},
		});
		const projected: number[] = [];
		client.subscribe((snapshot) => projected.push(snapshot.revision));

		await expect(client.getSnapshot()).rejects.toThrow('worker restarting');
		expect(projected).toEqual([]);
		expect(patchAttempts).toBe(0);
	});

	test('binds one explicit retry action for a failed initialization', () => {
		const button: { onclick: (() => void) | null } = { onclick: null };
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementById: (id: string) => id === 'options-retry' ? button : null },
		});
		let retries = 0;
		bindOptionsRetry(() => { retries += 1; });
		if (!button.onclick) throw new Error('Expected Options retry to be bound');
		button.onclick();
		expect(retries).toBe(1);
	});
});
