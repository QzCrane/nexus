import { describe, expect, test } from 'bun:test';
import type { TabSessionIdentity } from '@nexus/contracts';
import {
	forgetAudioSession,
	getAudioSession,
	updateAudioSession,
} from '../src/background/audio-session-store';

class FakeSessionStorage {
	readonly values: Record<string, unknown> = {};

	async get(storageKey: string): Promise<Record<string, unknown>> {
		return storageKey in this.values
			? { [storageKey]: structuredClone(this.values[storageKey]) }
			: {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		Object.assign(this.values, structuredClone(items));
	}

	async remove(storageKey: string): Promise<void> {
		delete this.values[storageKey];
	}
}

function identityFor(tabId: number, documentId: string): TabSessionIdentity {
	return { tabId, documentId, origin: 'https://media.example' };
}

function installChrome(storage: FakeSessionStorage): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			storage: { session: storage },
			runtime: {
				id: 'spectra-test',
				sendMessage: async () => undefined,
			},
		},
	});
}

describe('audio session establishment', () => {
	test('never infers an acknowledged phase from actualMode', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage);
		const identity = identityFor(9_301, 'establish-doc');
		try {
			// A write that declares Capture but no phase must not produce an
			// acknowledged 'active': that value is what made the badge report a
			// hijacked session for a processor that never started.
			const snapshot = await updateAudioSession(identity, { actualMode: 'capture', generation: 1 });
			expect(snapshot.actualMode).toBe('capture');
			expect(snapshot.phase).toBe('idle');

			const persisted = await getAudioSession(identity.tabId);
			expect(persisted?.phase).toBe('idle');
		} finally {
			await forgetAudioSession(identity.tabId);
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('downgrades an unreadable phase instead of upgrading the lifecycle', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage);
		const identity = identityFor(9_302, 'garbage-doc');
		try {
			const snapshot = await updateAudioSession(identity, {
				actualMode: 'webaudio',
				phase: 'not-a-phase',
				generation: 1,
			});
			expect(snapshot.phase).toBe('idle');
		} finally {
			await forgetAudioSession(identity.tabId);
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('an unspecified phase inherits the previous phase rather than restating a live one', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage);
		const identity = identityFor(9_303, 'inherit-doc');
		try {
			await updateAudioSession(identity, { actualMode: 'capture', phase: 'starting', generation: 1 });
			const started = await updateAudioSession(identity, { actualMode: 'capture', generation: 1 });
			expect(started.phase).toBe('starting');

			await updateAudioSession(identity, { actualMode: 'capture', phase: 'active', generation: 2 });
			const active = await updateAudioSession(identity, { actualMode: 'capture', generation: 2 });
			// Inheritance must not resurrect a lifecycle that a later write moved away
			// from, and must not fabricate one that was never acknowledged.
			expect(active.phase).toBe('active');
		} finally {
			await forgetAudioSession(identity.tabId);
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
