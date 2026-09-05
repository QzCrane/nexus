import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, type TabSessionIdentity } from '@nexus/contracts';
import {
	audioSessionTestApi,
	bindAudioSessionDocument,
	fenceAudioSession,
	flushAudioSessions,
	forgetAudioSession,
	getAudioSession,
	isAudioSessionIdentityInvalidated,
	removeAudioSession,
	StaleAudioSessionError,
	updateAudioSession,
} from '../src/background/audio-session-store';

class FakeSessionStorage {
	readonly values: Record<string, unknown> = {};
	readonly setCalls: Array<Record<string, unknown>> = [];
	readonly removeCalls: string[] = [];

	async get(storageKey: string): Promise<Record<string, unknown>> {
		return storageKey in this.values
			? { [storageKey]: structuredClone(this.values[storageKey]) }
			: {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		this.setCalls.push(structuredClone(items));
		Object.assign(this.values, structuredClone(items));
	}

	async remove(storageKey: string): Promise<void> {
		this.removeCalls.push(storageKey);
		delete this.values[storageKey];
	}
}

describe('acknowledged audio session store', () => {
	test('serializes concurrent updates for one tab without losing the later ACK', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		const broadcasts: unknown[] = [];
		installChrome(storage, broadcasts);

		const identity = identityFor(8_101, 'document-concurrent');
		try {
			const first = updateAudioSession(identity, {
				generation: 1,
				actualMode: 'capture',
				phase: 'starting',
				config: { volume: 125 },
			});
			const second = updateAudioSession(identity, {
				generation: 2,
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 180 },
			});
			const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
			expect(firstSnapshot.generation).toBe(1);
			expect(firstSnapshot.actualMode).toBe('capture');
			expect(secondSnapshot.generation).toBe(2);
			expect(secondSnapshot.actualMode).toBe('capture');
			expect(secondSnapshot.actualConfig.volume).toBe(180);
			expect(storage.setCalls).toHaveLength(2);
			expect(broadcasts).toHaveLength(2);
			expect(await getAudioSession(identity.tabId)).toEqual(secondSnapshot);
			await flushAudioSessions(identity.tabId);
			expect(storage.setCalls).toHaveLength(2);
			expect(storage.values.spectra_audio_session_8101).toEqual(secondSnapshot);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('persists canonical WebAudio while downgrading the retired enum token', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage, []);
		let tabId = 8_107;
		try {
			for (const [mode, expected] of [
				['webaudio', 'webaudio'],
				['NATIVE_WEBAUDIO', 'bypass'],
			] as const) {
				const identity = identityFor(tabId, `document-retired-${tabId}`);
				tabId += 1;
				const snapshot = await updateAudioSession(identity, {
					generation: 1,
					desiredMode: mode,
					actualMode: mode,
					phase: 'idle',
				});
				expect(snapshot.desiredMode).toBe(expected);
				expect(snapshot.actualMode).toBe(expected);
				expect(snapshot.phase).toBe('idle');
				expect((await getAudioSession(identity.tabId))?.actualMode).toBe(expected);
				await removeAudioSession(identity.tabId);
			}
		} finally {
			restoreChrome(originalChrome);
		}
	});

	test('migrates a persisted legacy snapshot before applying strict AudioConfig validation', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage, []);
		const tabId = 8_109;
		const legacyConfig: Record<string, unknown> = { ...DEFAULT_AUDIO_CONFIG };
		Reflect.deleteProperty(legacyConfig, 'volumeBase');
		Reflect.deleteProperty(legacyConfig, 'boost');
		storage.values.spectra_audio_session_8109 = {
			tabId,
			documentId: 'document-legacy',
			origin: 'https://media.example',
			generation: 3,
			desiredMode: 'webaudio',
			actualMode: 'webaudio',
			phase: 'active',
			configRevision: 4,
			actualConfig: {
				...legacyConfig,
				volume: 275,
				muted: true,
			},
			lastError: null,
		};

		try {
			const restored = await getAudioSession(tabId);
			expect(restored).toMatchObject({
				tabId,
				desiredMode: 'webaudio',
				actualMode: 'webaudio',
				phase: 'idle',
				actualConfig: {
					volume: 275,
					volumeBase: 100,
					boost: 2.75,
					muted: true,
				},
			});
			expect(storage.setCalls).toHaveLength(1);
		expect(storage.values.spectra_audio_session_8109).toMatchObject({
				actualConfig: { volume: 275, volumeBase: 100, boost: 2.75 },
			});
		} finally {
			await removeAudioSession(tabId);
			restoreChrome(originalChrome);
		}
	});

	test('drops an ACK whose generation is lower than the acknowledged snapshot', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		const broadcasts: unknown[] = [];
		installChrome(storage, broadcasts);

		const identity = identityFor(8_102, 'document-generation');
		try {
			const acknowledged = await updateAudioSession(identity, {
				generation: 8,
				desiredMode: 'capture',
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 220 },
			});
			const writeCount = storage.setCalls.length;
			const broadcastCount = broadcasts.length;

			const stale = await updateAudioSession(identity, {
				generation: 7,
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'error',
				config: { volume: 20 },
				error: 'late startup failure',
			});

			expect(stale).toEqual(acknowledged);
			expect(storage.setCalls).toHaveLength(writeCount);
			expect(broadcasts).toHaveLength(broadcastCount);
			expect(await getAudioSession(identity.tabId)).toEqual(acknowledged);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('keeps desired config out of actualConfig until a transition is acknowledged', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage, []);

		const identity = identityFor(8_105, 'document-ack-config');
		try {
			const active = await updateAudioSession(identity, {
				generation: 4,
				desiredMode: 'capture',
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 180 },
			});
			const stopping = await updateAudioSession(identity, {
				generation: 5,
				desiredMode: 'bypass',
				actualMode: 'capture',
				phase: 'stopping',
				config: { volume: 100 },
			});

			expect(active.actualConfig.volume).toBe(180);
			expect(stopping.actualConfig.volume).toBe(180);
			expect(stopping.configRevision).toBe(active.configRevision);

			const idle = await updateAudioSession(identity, {
				generation: 5,
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
				config: { volume: 100 },
			});
			expect(idle.actualConfig.volume).toBe(100);
			expect(idle.configRevision).toBe(active.configRevision + 1);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('rejects same-generation transitional regressions after a stable ACK', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		const broadcasts: unknown[] = [];
		installChrome(storage, broadcasts);

		const identity = identityFor(8_106, 'document-phase-order');
		try {
			const starting = await updateAudioSession(identity, {
				generation: 20,
				actualMode: 'capture',
				phase: 'starting',
			});
			const active = await updateAudioSession(identity, {
				generation: 20,
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 175 },
			});
			const lateStopping = await updateAudioSession(identity, {
				generation: 20,
				actualMode: 'capture',
				phase: 'stopping',
				config: { volume: 20 },
			});
			expect(starting.phase).toBe('starting');
			expect(active.phase).toBe('active');
			expect(lateStopping).toEqual(active);

			const stopping = await updateAudioSession(identity, {
				generation: 21,
				actualMode: 'capture',
				phase: 'stopping',
			});
			const idle = await updateAudioSession(identity, {
				generation: 21,
				actualMode: 'bypass',
				phase: 'idle',
			});
			const lateStarting = await updateAudioSession(identity, {
				generation: 21,
				actualMode: 'capture',
				phase: 'starting',
			});
			expect(stopping.phase).toBe('stopping');
			expect(idle.phase).toBe('idle');
			expect(lateStarting).toEqual(idle);

			await updateAudioSession(identity, {
				generation: 22,
				actualMode: 'capture',
				phase: 'starting',
			});
			const failed = await updateAudioSession(identity, {
				generation: 22,
				actualMode: 'bypass',
				phase: 'error',
				error: 'permission denied',
			});
			const lateRetry = await updateAudioSession(identity, {
				generation: 22,
				actualMode: 'capture',
				phase: 'starting',
			});
			expect(failed.phase).toBe('error');
			expect(lateRetry).toEqual(failed);
			expect(broadcasts).toHaveLength(6);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('never revives an invalidated document after navigation', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage, []);

		const oldDocument = identityFor(8_103, 'document-before-navigation');
		const newDocument = identityFor(8_103, 'document-after-navigation');
		try {
			await updateAudioSession(oldDocument, {
				generation: 4,
				actualMode: 'capture',
				phase: 'active',
			});
			await removeAudioSession(oldDocument.tabId);
			expect(isAudioSessionIdentityInvalidated(oldDocument)).toBe(true);
			expect(isAudioSessionIdentityInvalidated(newDocument)).toBe(true);
			bindAudioSessionDocument(newDocument.tabId, newDocument.documentId);
			expect(isAudioSessionIdentityInvalidated(newDocument)).toBe(false);

			await expect(updateAudioSession(oldDocument, {
				generation: 5,
				actualMode: 'capture',
				phase: 'active',
			})).rejects.toBeInstanceOf(StaleAudioSessionError);

			const current = await updateAudioSession(newDocument, {
				generation: 1,
				actualMode: 'capture',
				phase: 'active',
			});
			expect(current.documentId).toBe(newDocument.documentId);

			await expect(updateAudioSession(oldDocument, {
				generation: 6,
				actualMode: 'capture',
				phase: 'active',
			})).rejects.toBeInstanceOf(StaleAudioSessionError);
			expect((await getAudioSession(oldDocument.tabId))?.documentId).toBe(newDocument.documentId);
		} finally {
			await removeAudioSession(oldDocument.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('rejects a storage continuation that crosses the document fence', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		const broadcasts: unknown[] = [];
		installChrome(storage, broadcasts);
		const identity = identityFor(8_111, 'document-in-flight');
		const originalSet = storage.set;
		let releaseWrite!: () => void;
		let signalWriteStarted!: () => void;
		const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
		const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
		storage.set = async (items) => {
			signalWriteStarted();
			await writeGate;
			return originalSet.call(storage, items);
		};
		let pending: Promise<unknown> | undefined;
		try {
			pending = updateAudioSession(identity, {
				generation: 1,
				actualMode: 'capture',
				phase: 'active',
			});
			await writeStarted;
			const previousEpoch = audioSessionTestApi.lifecycleEpoch(identity.tabId);
			fenceAudioSession(identity.tabId);
			expect(audioSessionTestApi.lifecycleEpoch(identity.tabId)).toBe(previousEpoch + 1);
			releaseWrite();
			await expect(pending).rejects.toBeInstanceOf(StaleAudioSessionError);
			expect(broadcasts).toHaveLength(0);
			await removeAudioSession(identity.tabId, { alreadyFenced: true });
			expect(storage.values.spectra_audio_session_8111).toBeUndefined();
		} finally {
			releaseWrite();
			await pending?.catch(() => undefined);
			storage.set = originalSet;
			await forgetAudioSession(identity.tabId).catch(() => undefined);
			restoreChrome(originalChrome);
		}
	});

	test('keeps document tombstones bounded to the current identity and epoch', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		installChrome(storage, []);

		const tabId = 8_104;
		const firstDocument = identityFor(tabId, 'document-0');
		const lifecycleCountBefore = audioSessionTestApi.lifecycleCount();
		try {
			await updateAudioSession(firstDocument, {
				generation: 1,
				actualMode: 'capture',
				phase: 'active',
			});
			for (let index = 1; index < 24; index += 1) {
				await removeAudioSession(tabId);
				bindAudioSessionDocument(tabId, `document-${index}`);
				await updateAudioSession(identityFor(tabId, `document-${index}`), {
					generation: 1,
					actualMode: 'capture',
					phase: 'active',
				});
			}

			expect(audioSessionTestApi.lifecycleCount()).toBe(lifecycleCountBefore + 1);
			expect(isAudioSessionIdentityInvalidated(firstDocument)).toBe(true);
			expect(isAudioSessionIdentityInvalidated(identityFor(tabId, 'document-23'))).toBe(false);

			await forgetAudioSession(tabId);
			expect(audioSessionTestApi.lifecycleCount()).toBe(lifecycleCountBefore);
			const reused = await updateAudioSession(identityFor(tabId, 'new-tab-document'), {
				generation: 1,
				actualMode: 'bypass',
				phase: 'idle',
			});
			expect(reused.documentId).toBe('new-tab-document');
		} finally {
			await forgetAudioSession(tabId);
			restoreChrome(originalChrome);
		}
	});
});

function identityFor(tabId: number, documentId: string): TabSessionIdentity {
	return { tabId, documentId, origin: 'https://media.example' };
}

function installChrome(storage: FakeSessionStorage, broadcasts: unknown[]): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			storage: { session: storage },
			runtime: {
				sendMessage: async (message: unknown) => {
					broadcasts.push(structuredClone(message));
				},
			},
		},
	});
}

function restoreChrome(descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, 'chrome', descriptor);
	else Reflect.deleteProperty(globalThis, 'chrome');
}
