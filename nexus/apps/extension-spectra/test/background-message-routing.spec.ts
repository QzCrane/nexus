import { describe, expect, test } from 'bun:test';
import { SPECTRA_PROTOCOL_VERSION } from '@nexus/contracts';
import { registerCommandHandlers } from '../src/background/handlers/commands';

describe('background v2 listener ownership', () => {
	test('command listener declines an unrelated tab request without responding', () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | null = null;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					onMessage: { addListener: (candidate: typeof listener) => { listener = candidate; } },
				},
			},
		});

		try {
			registerCommandHandlers();
			expect(listener).not.toBeNull();
			const responses: unknown[] = [];
			const claimed = listener?.(
				{
					protocolVersion: SPECTRA_PROTOCOL_VERSION,
					requestId: 'unrelated-tab-request',
					type: 'spectra.tab.visible.list',
					payload: {},
				},
				{ id: 'spectra-test' } as chrome.runtime.MessageSender,
				(value) => { responses.push(value); },
			);
			expect(claimed).toBe(false);
			expect(responses).toEqual([]);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
