import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	REMOTE_COMMANDS,
	REMOTE_COMMAND_DESCRIPTORS,
	type ControlApplyAck,
	type ControlSnapshot,
} from '@nexus/contracts';
import {
	executeCommand,
	setStateCallback,
	syncState,
	type RemoteControlGateway,
} from '../src/background/remote-commands';

const TAB_ID = 9_301;

afterEach(async () => {
	setStateCallback(null);
});

describe('remote acknowledged audio state', () => {
	test('maps every remote button to one canonical control algorithm and transform', () => {
		expect(Object.keys(REMOTE_COMMAND_DESCRIPTORS).sort()).toEqual([...REMOTE_COMMANDS].sort());
		expect(REMOTE_COMMAND_DESCRIPTORS.volume_up).toEqual({
			capability: 'volumeBase', operation: 'delta', value: 10, legacyAlias: false,
		});
		expect(REMOTE_COMMAND_DESCRIPTORS.boost_up).toEqual({
			capability: 'boost', operation: 'delta', value: 0.1, legacyAlias: false,
		});
		expect(REMOTE_COMMAND_DESCRIPTORS.volume_max).toEqual({
			capability: 'boost', operation: 'set', value: 8, legacyAlias: true,
		});
	});

	test('publishes background actualConfig/generation without reading desired runtime config', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const snapshot: ControlSnapshot = {
			tabId: TAB_ID,
			documentId: 'document-remote-state',
			origin: 'https://media.example',
			generation: 17,
			revision: 4,
			activeMedia: null,
			activeVideo: null,
			fields: {
				volumeBase: field(100),
				boost: field(1, 'media-webaudio', 'full'),
				mediaMuted: field(false),
				playing: field(true),
				speed: field(1.5),
			},
		};
		const getSnapshot = mock(async () => structuredClone(snapshot));
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					onMessage: { addListener: () => undefined },
				},
				tabs: {
					get: async () => ({
						id: TAB_ID,
						title: 'Remote media',
						url: 'https://media.example/watch',
					}),
				},
			},
		});

		try {
			let published: unknown;
			setStateCallback((_tabId, state) => { published = state; });
			await syncState(TAB_ID, gateway({ getSnapshot }));

			expect(published).toEqual({
				generation: 17,
				volume: 100,
				volumeBase: 100,
				boost: 1,
				muted: false,
				playing: true,
				speed: 1.5,
				tabTitle: 'Remote media',
				tabDomain: 'media.example',
			});
			expect(getSnapshot).toHaveBeenCalledTimes(1);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('keeps the last applied remote values when a same-document field enters error', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const snapshots: ControlSnapshot[] = [
			{
				tabId: TAB_ID, documentId: 'document-stable', origin: 'https://media.example',
				generation: 21, revision: 7, activeMedia: null, activeVideo: null,
				fields: {
					volumeBase: field(72), boost: field(1.5, 'media-webaudio', 'full'),
					mediaMuted: field(true), playing: field(true), speed: field(1.25),
				},
			},
			{
				tabId: TAB_ID, documentId: 'document-stable', origin: 'https://media.example',
				generation: 21, revision: 8, activeMedia: null, activeVideo: null,
				fields: {
					volumeBase: {
						...field(100), actual: null, phase: 'error', strategy: 'unsupported', controlled: false,
						lastError: { code: 'native_write_failed', message: 'Page rejected volume', retryable: true },
					},
					playing: {
						...field(false), actual: null, phase: 'applying', controlled: false,
					},
				},
			},
		];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test', onMessage: { addListener: () => undefined },
				},
				tabs: {
					get: async () => ({ id: TAB_ID, title: 'Remote media', url: 'https://media.example/watch' }),
				},
			},
		});
		try {
			const published: Array<import('../src/remote/protocol').RemoteState> = [];
			setStateCallback((_tabId, state) => published.push(state));
			const control = gateway({ getSnapshot: async () => structuredClone(snapshots.shift() ?? null) });
			await syncState(TAB_ID, control);
			await syncState(TAB_ID, control);
			expect(published).toHaveLength(2);
			expect(published[1]).toMatchObject({
				generation: 21, volumeBase: 72, boost: 1.5, volume: 108,
				muted: true, playing: true, speed: 1.25,
			});
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('submits one typed coordinator mutation and never calls a legacy media RPC', async () => {
		const requests: unknown[] = [];
		const control = gateway({
			submit: async (request) => {
				requests.push(structuredClone(request));
				return controlAck({ volumeBase: field(90) });
			},
		});
		expect(await executeCommand('volume_down', TAB_ID, control)).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			tabId: TAB_ID,
			source: 'remote',
			requestedCoverage: 'active-target',
			mutations: [{ field: 'volumeBase', operation: 'delta', value: -10 }],
		});
	});

	test('rejects a transport-success response whose requested field failed', async () => {
		const control = gateway({
			submit: async () => controlAck({
				volumeBase: {
					...field(90),
					actual: null,
					phase: 'error' as const,
					strategy: 'unsupported' as const,
					controlled: false,
					lastError: {
						code: 'native_write_failed',
						message: 'Page rejected volume',
						retryable: true,
					},
				},
			}),
		});
		await expect(executeCommand('volume_down', TAB_ID, control)).rejects.toThrow('Page rejected volume');
	});
});

function gateway(overrides: Partial<RemoteControlGateway> = {}): RemoteControlGateway {
	return {
		submit: async () => controlAck({}),
		submitOperation: async () => {
			throw new Error('Unexpected remote operation');
		},
		getSnapshot: async () => null,
		...overrides,
	};
}

function controlAck(fields: ControlApplyAck['fields']): ControlApplyAck {
	return {
		intentId: 'remote-intent',
		tabId: TAB_ID,
		documentId: 'document-remote',
		generation: 3,
		revision: 8,
		target: null,
		fields,
	};
}

function field<T>(
	actual: T,
	strategy: 'dom-native' | 'media-webaudio' = 'dom-native',
	coverage: 'active-target' | 'full' = 'active-target',
) {
	return {
		desired: actual,
		actual,
		revision: 4,
		phase: 'applied' as const,
		strategy,
		coverage,
		controlled: true,
		intentId: 'remote-state',
		lastError: null,
	};
}
