import { beforeEach, describe, expect, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import {
	CONTROL_SESSION_FIELDS,
	DEFAULT_AUDIO_CONFIG,
	type ControlSessionPatch,
} from '@nexus/contracts';
import type { TabControlSessionIdentity } from '@nexus/kernel';

const values: Record<string, unknown> = {};
const setCalls: Array<Record<string, unknown>> = [];
// Origin-portable merges also write a separate origin-session key; these tests
// assert tab-session persistence only, so count tab-session writes exclusively.
const tabSetCalls = (): Array<Record<string, unknown>> =>
	setCalls.filter((call) => Object.keys(call)[0]?.startsWith('tab_session_'));
let setFailuresRemaining = 0;

Object.assign(globalThis, {
	chrome: {
		storage: {
			session: {
				async get(key: string) {
					return key in values ? { [key]: structuredClone(values[key]) } : {};
				},
				async set(items: Record<string, unknown>) {
					setCalls.push(structuredClone(items));
					if (setFailuresRemaining > 0) {
						setFailuresRemaining -= 1;
						throw new Error('session storage unavailable');
					}
					Object.assign(values, structuredClone(items));
				},
				async remove(key: string) {
					delete values[key];
				},
			},
		},
	},
});

const {
	audioConfigToControlSessionPatch,
	controlSessionPatchToAudioConfig,
	flushTabControlSession,
	getTabControlSession,
	mergeTabControlSession,
	rebindTabControlSession,
	removeTabControlSession,
} = await import('../../../packages/nexus-kernel/src/storage/tab-session');

const firstDocument: TabControlSessionIdentity = {
	tabId: 7,
	documentId: 'document-a',
	origin: 'https://example.com',
	resourceUrl: 'https://example.com/recommend',
};
const secondDocument: TabControlSessionIdentity = {
	...firstDocument,
	documentId: 'document-b',
};
const detailDocument: TabControlSessionIdentity = {
	...secondDocument,
	documentId: 'document-detail',
	resourceUrl: 'https://example.com/watch/42',
};
const otherOriginDocument: TabControlSessionIdentity = {
	...secondDocument,
	documentId: 'document-c',
	origin: 'https://other.example',
	resourceUrl: 'https://other.example/recommend',
};

const completeSession: ControlSessionPatch = {
	audioEnabled: true,
	volumeBase: 100,
	boost: 2.4,
	mediaMuted: true,
	speed: 1.75,
	preservePitch: false,
	loop: true,
	rotation: 90,
	mirrored: true,
	fill: true,
	filterEnabled: true,
	filter: {
		brightness: 115,
		contrast: 92,
		saturate: 108,
		grayscale: false,
		invert: true,
	},
	dimEnabled: true,
	dimOpacity: 0.55,
	eqValues: [1, 0, -1, 2, -2, 3, -3, 4, -4, 5],
	bass: true,
	compressor: true,
	mono: false,
	pan: -0.25,
	delay: 80,
};

beforeEach(async () => {
	await removeTabControlSession(7);
	for (const key of Object.keys(values)) delete values[key];
	setCalls.length = 0;
	setFailuresRemaining = 0;
});

describe('document-bound acknowledged control sessions', () => {
	test('does not leak settings into a different document', async () => {
		await mergeTabControlSession(7, { volumeBase: 100, boost: 2.5 }, firstDocument);
		expect(await getTabControlSession(7, firstDocument)).toEqual({
			volumeBase: 100,
			boost: 2.5,
		});
		expect(await getTabControlSession(7, secondDocument)).toBeNull();

		await mergeTabControlSession(7, { mediaMuted: true }, secondDocument);
		expect(await getTabControlSession(7, secondDocument)).toEqual({ mediaMuted: true });
		expect(await getTabControlSession(7, firstDocument)).toBeNull();
	});

	test('discards unidentifiable legacy tabId-only entries', async () => {
		values.tab_session_7 = { volume: 400 };
		expect(await getTabControlSession(7, firstDocument)).toBeNull();
		expect(values.tab_session_7).toBeUndefined();
	});

	test('persists every acknowledged field update as a complete versioned projection', async () => {
		await mergeTabControlSession(7, { volumeBase: 100, boost: 1.5 }, firstDocument);
		await mergeTabControlSession(7, { boost: 1.75, mediaMuted: true, speed: 1.5 }, firstDocument);

		expect(tabSetCalls()).toHaveLength(2);
		expect(await getTabControlSession(7, firstDocument)).toEqual({
			volumeBase: 100,
			boost: 1.75,
			mediaMuted: true,
			speed: 1.5,
		});

		await flushTabControlSession(7);
		expect(tabSetCalls()).toHaveLength(2);
		expect(values.tab_session_7).toMatchObject({
			version: 3,
			identity: firstDocument,
			patch: {
				volumeBase: 100,
				boost: 1.75,
				mediaMuted: true,
				speed: 1.5,
			},
			portablePatch: {
				volumeBase: 100,
				boost: 1.75,
				mediaMuted: true,
				speed: 1.5,
			},
		});
	});

	test('does not acknowledge a control session before a replacement worker can read it', async () => {
		expect(Object.keys(completeSession).sort()).toEqual([...CONTROL_SESSION_FIELDS].sort());
		await mergeTabControlSession(7, completeSession, firstDocument);

		expect(values.tab_session_7).toMatchObject({
			version: 3,
			identity: firstDocument,
			patch: completeSession,
			portablePatch: completeSession,
		});
	});

	test('retries bounded transient writes and propagates an undurable ACK', async () => {
		setFailuresRemaining = 2;
		await mergeTabControlSession(7, { speed: 1.25 }, firstDocument);
		expect(tabSetCalls()).toHaveLength(3);
		expect(values.tab_session_7).toMatchObject({ patch: { speed: 1.25 } });

		await removeTabControlSession(7);
		setCalls.length = 0;
		setFailuresRemaining = 3;
		await expect(mergeTabControlSession(
			7,
			{ speed: 1.5 },
			firstDocument,
		)).rejects.toThrow('session storage unavailable');
		expect(tabSetCalls()).toHaveLength(3);
		expect(values.tab_session_7).toBeUndefined();
	});

	test('rebinds every durable acknowledged field across an exact-resource reload', async () => {
		await mergeTabControlSession(7, completeSession, firstDocument, 'resource');
		expect(await rebindTabControlSession(7, secondDocument)).toEqual(completeSession);
		expect(await getTabControlSession(7, firstDocument)).toBeNull();
		expect(await getTabControlSession(7, secondDocument)).toEqual(completeSession);
	});

	test('keeps the same document across a History API resource change', async () => {
		await mergeTabControlSession(7, { speed: 1.5 }, firstDocument);
		const sameDocumentRoute = {
			...firstDocument,
			resourceUrl: detailDocument.resourceUrl,
		};

		expect(await rebindTabControlSession(7, sameDocumentRoute)).toEqual({ speed: 1.5 });
		expect(values.tab_session_7).toMatchObject({ identity: sameDocumentRoute });
	});

	test('retires page observations instead of replaying them into another same-origin resource', async () => {
		await mergeTabControlSession(7, {
			volumeBase: 100,
			mediaMuted: true,
		}, firstDocument, 'resource');

		expect(await rebindTabControlSession(7, detailDocument)).toBeNull();
		expect(await getTabControlSession(7)).toBeNull();
	});

	test('carries explicit extension fields but drops page-owned fields on a new resource', async () => {
		await mergeTabControlSession(7, { boost: 2, speed: 1.5 }, firstDocument);
		await mergeTabControlSession(7, {
			mediaMuted: true,
			speed: 1.25,
		}, firstDocument, 'resource');

		expect(await rebindTabControlSession(7, detailDocument)).toEqual({ boost: 2 });
		expect(values.tab_session_7).toMatchObject({
			identity: detailDocument,
			patch: { boost: 2 },
			portablePatch: { boost: 2 },
		});
	});

	test('atomically preserves the complete resource projection while promoting only the explicit delta', async () => {
		const currentResourcePatch: ControlSessionPatch = {
			volumeBase: 42,
			boost: 1,
			mediaMuted: false,
			speed: 1.1,
		};
		await mergeTabControlSession(
			7,
			{ speed: 1.1 },
			firstDocument,
			'origin',
			currentResourcePatch,
		);

		expect(await getTabControlSession(7, firstDocument)).toEqual(currentResourcePatch);
		expect(values.tab_session_7).toMatchObject({
			patch: currentResourcePatch,
			portablePatch: { speed: 1.1 },
		});
		expect(await rebindTabControlSession(7, detailDocument)).toEqual({ speed: 1.1 });
	});

	test('does not guess an exact-resource reload for a v2 session without a resource URL', async () => {
		values.tab_session_7 = {
			version: 2,
			identity: {
				tabId: firstDocument.tabId,
				documentId: firstDocument.documentId,
				origin: firstDocument.origin,
			},
			patch: { mediaMuted: true },
			updatedAt: 123,
		};

		expect(await rebindTabControlSession(7, secondDocument)).toBeNull();
		expect(values.tab_session_7).toBeUndefined();
	});

	test('keeps an all-default acknowledged session instead of falling through to presets', async () => {
		const defaults: ControlSessionPatch = {
			volumeBase: 100,
			boost: 1,
			mediaMuted: false,
			speed: 1,
		};
		await mergeTabControlSession(7, defaults, firstDocument);
		expect(await rebindTabControlSession(7, secondDocument)).toEqual(defaults);
	});

	test('retires a tab session when navigation crosses origins', async () => {
		await mergeTabControlSession(7, completeSession, firstDocument);
		expect(await rebindTabControlSession(7, otherOriginDocument)).toBeNull();
		expect(await getTabControlSession(7)).toBeNull();
	});

	test('migrates the previous acknowledged AudioConfig without losing volume or speed', async () => {
		const legacyConfig = {
			...DEFAULT_AUDIO_CONFIG,
			volume: 275,
			volumeBase: 100,
			boost: 2.75,
			muted: true,
			speed: 1.8,
		};
		values.tab_session_7 = {
			identity: firstDocument,
			config: legacyConfig,
			updatedAt: 123,
		};

		const migrated = await getTabControlSession(7, firstDocument);
		expect(migrated).toEqual(audioConfigToControlSessionPatch(legacyConfig));
		const migratedSession = requireValue(
			migrated,
			'Expected the legacy tab session to migrate to a control-session patch',
		);
		expect(controlSessionPatchToAudioConfig(migratedSession)).toMatchObject({
			volume: 275,
			volumeBase: 100,
			boost: 2.75,
			muted: true,
			speed: 1.8,
		});
		await flushTabControlSession(7);
		expect(values.tab_session_7).toMatchObject({
			version: 3,
			identity: firstDocument,
			patch: { volumeBase: 100, boost: 2.75, mediaMuted: true, speed: 1.8 },
			portablePatch: {},
		});
	});

	test('migrates a legacy AudioConfig missing the volume pair before strict validation', async () => {
		const legacyConfig: Record<string, unknown> = { ...DEFAULT_AUDIO_CONFIG };
		Reflect.deleteProperty(legacyConfig, 'volumeBase');
		Reflect.deleteProperty(legacyConfig, 'boost');
		const storedLegacyConfig = {
			...legacyConfig,
			volume: 275,
			muted: true,
			speed: 1.8,
		};
		values.tab_session_7 = {
			identity: firstDocument,
			config: storedLegacyConfig,
			updatedAt: 456,
		};

		const migrated = await getTabControlSession(7, firstDocument);
		expect(migrated).toMatchObject({
			volumeBase: 100,
			boost: 2.75,
			mediaMuted: true,
			speed: 1.8,
		});
		expect(values.tab_session_7).toMatchObject({
			version: 3,
			patch: { volumeBase: 100, boost: 2.75, mediaMuted: true, speed: 1.8 },
			portablePatch: {},
		});
	});

	test('clears a malformed legacy AudioConfig instead of bypassing strict validation', async () => {
		const malformedConfig: Record<string, unknown> = { ...DEFAULT_AUDIO_CONFIG };
		Reflect.deleteProperty(malformedConfig, 'volumeBase');
		Reflect.deleteProperty(malformedConfig, 'boost');
		Reflect.deleteProperty(malformedConfig, 'preservePitch');
		values.tab_session_7 = {
			identity: firstDocument,
			config: malformedConfig,
			updatedAt: 789,
		};

		expect(await getTabControlSession(7, firstDocument)).toBeNull();
		expect(values.tab_session_7).toBeUndefined();
	});
});
