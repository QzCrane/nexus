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
	scheduleAudioSessionProjection,
	StaleAudioSessionError,
	updateAudioSession,
} from '../src/background/audio-session-store';

class FakeSessionStorage {
	readonly values: Record<string, unknown> = {};
	readonly setCalls: Array<Record<string, unknown>> = [];
	readonly removeCalls: string[] = [];
	onSet?: (items: Record<string, unknown>) => void;

	async get(storageKey: string): Promise<Record<string, unknown>> {
		return storageKey in this.values
			? { [storageKey]: structuredClone(this.values[storageKey]) }
			: {};
	}

	async set(items: Record<string, unknown>): Promise<void> {
		this.setCalls.push(structuredClone(items));
		Object.assign(this.values, structuredClone(items));
		this.onSet?.(items);
	}

	async remove(storageKey: string): Promise<void> {
		this.removeCalls.push(storageKey);
		delete this.values[storageKey];
	}
}

describe('acknowledged audio session store', () => {
	test('canonical flush waits for projection-only serialized work', async () => {
		let releaseProjection!: () => void;
		let signalProjectionStarted!: () => void;
		const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
		const projectionStarted = new Promise<void>((resolve) => { signalProjectionStarted = resolve; });
		scheduleAudioSessionProjection(8_113, async () => {
			signalProjectionStarted();
			await projectionGate;
		});
		await projectionStarted;
		let flushed = false;
		const flush = flushAudioSessions().then(() => { flushed = true; });
		await Promise.resolve();
		expect(flushed).toBe(false);
		releaseProjection();
		await flush;
		expect(flushed).toBe(true);
	});

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
			await flushAudioSessions(identity.tabId);
			expect(firstSnapshot.generation).toBe(1);
			expect(firstSnapshot.actualMode).toBe('capture');
			expect(secondSnapshot.generation).toBe(2);
			expect(secondSnapshot.actualMode).toBe('capture');
			expect(secondSnapshot.actualConfig.volume).toBe(180);
			expect(storage.setCalls).toHaveLength(2);
			// Presentation runs independently from authority: the first committed
			// lifecycle may publish while the second durable update proceeds, and the
			// final projection must still be the later acknowledged snapshot.
			expect(broadcasts).toHaveLength(2);
			expect(broadcasts.map((event) => (
				(event as { payload: { generation: number } }).payload.generation
			))).toEqual([1, 2]);
			expect(broadcasts.at(-1)).toMatchObject({ payload: secondSnapshot });
			expect(await getAudioSession(identity.tabId)).toEqual(secondSnapshot);
			expect(storage.setCalls).toHaveLength(2);
			expect(storage.values.spectra_audio_session_8101).toEqual(secondSnapshot);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('acknowledges the durable session before its runtime broadcast settles', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		let releaseBroadcast!: () => void;
		let signalBroadcastStarted!: () => void;
		const broadcastGate = new Promise<void>((resolve) => { releaseBroadcast = resolve; });
		const broadcastStarted = new Promise<void>((resolve) => { signalBroadcastStarted = resolve; });
		installChrome(storage, []);
		globalThis.chrome.runtime.sendMessage = async () => {
			signalBroadcastStarted();
			await broadcastGate;
		};

		const identity = identityFor(8_112, 'document-projection-barrier');
		let update: Promise<Awaited<ReturnType<typeof updateAudioSession>>> | undefined;
		try {
			let acknowledged = false;
			update = updateAudioSession(identity, {
				generation: 1,
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 110 },
			}).then((snapshot) => {
				acknowledged = true;
				return snapshot;
			});
			await broadcastStarted;
			const acknowledgedSnapshot = await update;
			expect(acknowledged).toBe(true);
			expect(acknowledgedSnapshot.generation).toBe(1);
			expect(storage.values.spectra_audio_session_8112).toMatchObject({
				generation: 1,
				actualConfig: { volume: 110 },
			});

			releaseBroadcast();
			await flushAudioSessions(identity.tabId);
		} finally {
			releaseBroadcast();
			await update?.catch(() => undefined);
			await removeAudioSession(identity.tabId).catch(() => undefined);
			restoreChrome(originalChrome);
		}
	});

	test('does not let a pending projection block the next durable session ACK', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		let releaseFirstProjection!: () => void;
		let signalFirstProjectionStarted!: () => void;
		let signalSecondCommit!: () => void;
		const firstProjectionGate = new Promise<void>((resolve) => { releaseFirstProjection = resolve; });
		const firstProjectionStarted = new Promise<void>((resolve) => { signalFirstProjectionStarted = resolve; });
		const secondCommit = new Promise<void>((resolve) => { signalSecondCommit = resolve; });
		let projectionCount = 0;
		installChrome(storage, []);
		globalThis.chrome.runtime.sendMessage = async () => {
			projectionCount += 1;
			if (projectionCount === 1) {
				signalFirstProjectionStarted();
				await firstProjectionGate;
			}
		};
		const identity = identityFor(8_114, 'document-next-ack');
		storage.onSet = (items) => {
			const snapshot = items.spectra_audio_session_8114 as { generation?: number } | undefined;
			if (snapshot?.generation === 2) signalSecondCommit();
		};

		try {
			await updateAudioSession(identity, {
				generation: 1,
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 110 },
			});
			await firstProjectionStarted;
			const second = updateAudioSession(identity, {
				generation: 2,
				actualMode: 'capture',
				phase: 'active',
				config: { volume: 120 },
			});
			// This storage commit is an exact causal barrier. It must occur while the
			// first presentation remains deliberately unresolved.
			await secondCommit;
			const acknowledged = await second;
			expect(acknowledged.generation).toBe(2);
			expect(acknowledged.actualConfig.volume).toBe(120);
			expect(projectionCount).toBe(1);
		} finally {
			releaseFirstProjection();
			await flushAudioSessions(identity.tabId).catch(() => undefined);
			await removeAudioSession(identity.tabId).catch(() => undefined);
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
			await flushAudioSessions(identity.tabId);

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
			await flushAudioSessions(identity.tabId);
			expect(failed.phase).toBe('error');
			expect(lateRetry).toEqual(failed);
			expect(broadcasts).toHaveLength(6);
		} finally {
			await removeAudioSession(identity.tabId);
			restoreChrome(originalChrome);
		}
	});

	test('refuses to persist a phase the same write contradicts', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const storage = new FakeSessionStorage();
		const broadcasts: unknown[] = [];
		installChrome(storage, broadcasts);

		const identity = identityFor(8_120, 'document-phase-evidence');
		try {
			// SP-04: the first write for a document cannot already be mid-stop.
			const firstStop = await updateAudioSession(identity, {
				generation: 1,
				actualMode: 'capture',
				phase: 'stopping',
			});
			expect(firstStop.phase).toBe('idle');

			// SP-08: `error -> active` needs a processor to become active about.
			const failing = await updateAudioSession(identity, {
				generation: 2,
				actualMode: 'bypass',
				phase: 'error',
				error: 'permission denied',
			});
			expect(failing.phase).toBe('error');
			const unbackedActive = await updateAudioSession(identity, {
				generation: 2,
				actualMode: 'bypass',
				phase: 'active',
			});
			expect(unbackedActive.phase).not.toBe('active');
			expect(unbackedActive.actualMode).toBe('bypass');

			// SP-07: an error with no text cannot replace an acknowledged active.
			await updateAudioSession(identity, {
				generation: 3,
				actualMode: 'capture',
				phase: 'starting',
			});
			const active = await updateAudioSession(identity, {
				generation: 3,
				actualMode: 'capture',
				phase: 'active',
			});
			expect(active.phase).toBe('active');
			const silentError = await updateAudioSession(identity, {
				generation: 3,
				actualMode: 'capture',
				phase: 'error',
				error: null,
			});
			expect(silentError.phase).toBe('active');
			expect(silentError.lastError).toBeNull();

			// A failure that can name itself still lands, and keeps the bad news.
			const named = await updateAudioSession(identity, {
				generation: 3,
				actualMode: 'capture',
				phase: 'error',
				error: 'device lost',
			});
			expect(named.phase).toBe('error');
			expect(named.lastError?.message).toBe('device lost');

			await flushAudioSessions(identity.tabId);
			const persisted = storage.values.spectra_audio_session_8120 as { phase: string };
			expect(persisted.phase).toBe('error');
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
