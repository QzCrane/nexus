import { describe, expect, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import {
	acquireOffscreenLease,
	getOffscreenLeaseCount,
	isOffscreenHostStateUnknown,
	reconcileOffscreenHost,
	releaseOffscreenLease,
	retireLegacyOffscreenDocument,
	sendOffscreenMessage,
} from '../src/background/offscreen-coordinator';

type TimerCallback = () => void;

describe('unified offscreen coordinator', () => {
	test('serializes creation, rolls back failed leases, reconciles host state, and closes once when idle', async () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
		const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');
		const timers = new Map<number, { callback: TimerCallback; delay: number }>();
		const alarms = new Map<string, { delayInMinutes: number }>();
		let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;
		let nextTimerId = 0;
		let hasDocument = false;
		let documentUrl = 'offscreen.html';
		let createCalls = 0;
		let closeCalls = 0;
		let rejectCreation = false;
		let finishCreation: (() => void) | undefined;
		let helloSnapshot: Record<string, unknown> = { audioTabs: [], remoteTabs: [] };
		let helloError: Error | null = null;
		let helloCalls = 0;
		const pairedSessionId = 'P'.repeat(22);
		const createOptions: Array<Record<string, unknown>> = [];

		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			value: (callback: TimerCallback, delay: number) => {
				const id = ++nextTimerId;
				timers.set(id, { callback, delay });
				return id;
			},
		});
		Object.defineProperty(globalThis, 'clearTimeout', {
			configurable: true,
			value: (id: number) => {
				timers.delete(id);
			},
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				alarms: {
					create: (name: string, info: { delayInMinutes: number }) => {
						alarms.set(name, info);
					},
					clear: async (name: string) => alarms.delete(name),
					onAlarm: {
						addListener: (listener: (alarm: chrome.alarms.Alarm) => void) => {
							alarmListener = listener;
						},
					},
				},
				offscreen: {
					hasDocument: async () => hasDocument,
					createDocument: async (options: Record<string, unknown>) => {
						createCalls += 1;
						createOptions.push(options);
						if (rejectCreation) throw new Error('offscreen creation rejected');
						await new Promise<void>((resolve) => {
							finishCreation = resolve;
						});
						hasDocument = true;
						documentUrl = 'offscreen.html';
					},
					closeDocument: async () => {
						closeCalls += 1;
						hasDocument = false;
					},
				},
				runtime: {
					getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
					getContexts: async (filter: { documentUrls: string[] }) => (
						hasDocument
							&& filter.documentUrls.includes(`chrome-extension://spectra-test/${documentUrl}`)
							? [{ documentUrl: `chrome-extension://spectra-test/${documentUrl}` }]
							: []
					),
					sendMessage: async (message: Record<string, unknown>) => {
						if (message.type === 'OFFSCREEN_HOST_HELLO') {
							helloCalls += 1;
							if (helloError) throw helloError;
							return helloSnapshot;
						}
						return undefined;
					},
				},
			},
		});

		try {
			hasDocument = true;
			documentUrl = 'offscreen-remote.html';
			expect(await retireLegacyOffscreenDocument()).toBe(true);
			expect(hasDocument).toBe(false);
			expect(closeCalls).toBe(1);
			// Keep the existing lifecycle assertions independent from the migration probe.
			closeCalls = 0;

			const audioLease = acquireOffscreenLease('audio:17');
			const remoteLease = acquireOffscreenLease('remote:session-17');
			await waitFor(() => createCalls === 1);

			expect(createCalls).toBe(1);
			expect(getOffscreenLeaseCount()).toBe(2);
			expect(createOptions).toEqual([{
				url: 'offscreen.html',
				reasons: ['USER_MEDIA', 'WEB_RTC'],
				justification: 'Audio processing and authenticated WebRTC remote control',
			}]);

			finishCreation?.();
			await Promise.all([audioLease, remoteLease]);
			expect(createCalls).toBe(1);
			await expect(sendOffscreenMessage({
				type: 'OFFSCREEN_AUDIO_STOP',
				tabId: 17,
				generation: 1,
			})).rejects.toThrow('Invalid offscreen host response: OFFSCREEN_AUDIO_STOP');

			releaseOffscreenLease('audio:17');
			expect(alarms.size).toBe(0);
			releaseOffscreenLease('remote:session-17');
			expect([...alarms.values()]).toEqual([{ delayInMinutes: 0.5 }]);
			await fireOnlyAlarm(alarms, alarmListener);
			await waitFor(() => closeCalls === 1);
			expect(getOffscreenLeaseCount()).toBe(0);

			rejectCreation = true;
			await expect(acquireOffscreenLease('audio:99')).rejects.toThrow('offscreen creation rejected');
			expect(getOffscreenLeaseCount()).toBe(0);
			expect(createCalls).toBe(2);
			expect(alarms.size).toBe(1);

			rejectCreation = false;
			hasDocument = true;
			helloSnapshot = {
				audioTabs: [{ tabId: 4, generation: 8 }],
				remoteTabs: [{ tabId: 5, sessionId: pairedSessionId }],
			};
			const snapshot = await reconcileOffscreenHost();
			expect(snapshot).toEqual(helloSnapshot);
			expect(getOffscreenLeaseCount()).toBe(2);
			expect(alarms.size).toBe(0);
			expect(timers.size).toBe(0);

			helloError = new Error('HELLO transport unavailable');
			const callsBeforeFailure = helloCalls;
			let reconcileFailure: unknown;
			void reconcileOffscreenHost().catch((error) => { reconcileFailure = error; });
			for (let retry = 0; retry < 2; retry += 1) {
				await waitFor(() => timers.size === 1);
				await fireOnlyTimer(timers);
			}
			await waitFor(() => reconcileFailure !== undefined);
			expect(reconcileFailure).toBeInstanceOf(Error);
			expect((reconcileFailure as Error).message).toBe(
				'Unable to reconcile the live offscreen host: HELLO transport unavailable',
			);
			expect(helloCalls - callsBeforeFailure).toBe(3);
			// A live-but-unresponsive host is unknown, not empty. Its recovered
			// leases must survive so an idle close cannot race its processors.
			expect(getOffscreenLeaseCount()).toBe(2);
			expect(isOffscreenHostStateUnknown()).toBe(true);
			expect(timers.size).toBe(0);
			helloError = null;

			helloSnapshot = { audioTabs: [], remoteTabs: [] };
			expect(await reconcileOffscreenHost()).toEqual(helloSnapshot);
			expect(getOffscreenLeaseCount()).toBe(0);
			expect(alarms.size).toBe(1);
			await fireOnlyAlarm(alarms, alarmListener);
			await waitFor(() => closeCalls === 2);
			expect(getOffscreenLeaseCount()).toBe(0);
			expect(timers.size).toBe(0);

			// A live host with no known lease must not retain unknown state forever.
			// Reconciliation enters the idle grace period; close performs one final
			// HELLO and reclaims the host only while it remains unresponsive.
			hasDocument = true;
			helloError = new Error('persistent HELLO failure');
			const callsBeforeUnownedFailure = helloCalls;
			let unownedReconcileFailure: unknown;
			void reconcileOffscreenHost().catch((error) => { unownedReconcileFailure = error; });
			for (let retry = 0; retry < 2; retry += 1) {
				await waitFor(() => timers.size === 1);
				await fireOnlyTimer(timers);
			}
			await waitFor(() => unownedReconcileFailure !== undefined);
			expect(isOffscreenHostStateUnknown()).toBe(false);
			expect(getOffscreenLeaseCount()).toBe(0);
			expect(alarms.size).toBe(1);
			await fireOnlyAlarm(alarms, alarmListener);
			await waitFor(() => closeCalls === 3);
			expect(helloCalls - callsBeforeUnownedFailure).toBe(4);
			expect(hasDocument).toBe(false);
			helloError = null;

			hasDocument = true;
			await acquireOffscreenLease('audio:77');
			expect(getOffscreenLeaseCount()).toBe(1);

			// A failed redundant acquire must not erase the original logical owner.
			hasDocument = false;
			rejectCreation = true;
			await expect(acquireOffscreenLease('audio:77')).rejects.toThrow('offscreen creation rejected');
			expect(getOffscreenLeaseCount()).toBe(1);
			releaseOffscreenLease('audio:77');
			expect(alarms.size).toBe(1);
			await fireOnlyAlarm(alarms, alarmListener);
			expect(getOffscreenLeaseCount()).toBe(0);
		} finally {
			if (getOffscreenLeaseCount() > 0) {
				for (const key of [
					'audio:17',
					'remote:session-17',
					'audio:99',
					'audio:4',
					`remote:${pairedSessionId}`,
					'audio:77',
				] as const) {
					releaseOffscreenLease(key);
				}
			}
			if (alarms.size === 1) {
				const previousCloseCalls = closeCalls;
				await fireOnlyAlarm(alarms, alarmListener);
				await waitFor(() => closeCalls > previousCloseCalls || !hasDocument);
			}
			alarms.clear();
			timers.clear();
			restoreProperty('chrome', chromeDescriptor);
			restoreProperty('setTimeout', setTimeoutDescriptor);
			restoreProperty('clearTimeout', clearTimeoutDescriptor);
		}
	});
});

async function fireOnlyAlarm(
	alarms: Map<string, { delayInMinutes: number }>,
	listener: ((alarm: chrome.alarms.Alarm) => void) | null,
): Promise<void> {
	expect(alarms.size).toBe(1);
	expect(listener).not.toBeNull();
	const [name, info] = requireValue(
		[...alarms.entries()][0],
		'Expected exactly one pending offscreen alarm',
	);
	alarms.delete(name);
	listener?.({ name, scheduledTime: Date.now() + info.delayInMinutes * 60_000 });
	await Promise.resolve();
}

async function fireOnlyTimer(timers: Map<number, { callback: TimerCallback }>): Promise<void> {
	expect(timers.size).toBe(1);
	const [id, timer] = requireValue(
		[...timers.entries()][0],
		'Expected exactly one pending offscreen timer',
	);
	timers.delete(id);
	timer.callback();
	await Promise.resolve();
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function restoreProperty(key: 'chrome' | 'setTimeout' | 'clearTimeout', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
