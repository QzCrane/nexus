import { beforeEach, describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	type ControlSessionPatch,
	type TabSessionIdentity,
} from '@nexus/contracts';

const values: Record<string, unknown> = {};
const setCalls: Array<Record<string, unknown>> = [];

Object.assign(globalThis, {
	chrome: {
		storage: {
			session: {
				async get(key: string) {
					return key in values ? { [key]: structuredClone(values[key]) } : {};
				},
				async set(items: Record<string, unknown>) {
					setCalls.push(structuredClone(items));
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

const firstDocument: TabSessionIdentity = {
	tabId: 7,
	documentId: 'document-a',
	origin: 'https://example.com',
};
const secondDocument: TabSessionIdentity = {
	...firstDocument,
	documentId: 'document-b',
};
const otherOriginDocument: TabSessionIdentity = {
	...secondDocument,
	documentId: 'document-c',
	origin: 'https://other.example',
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

	test('coalesces field updates and flushes one versioned projection', async () => {
		await mergeTabControlSession(7, { volumeBase: 100, boost: 1.5 }, firstDocument);
		await mergeTabControlSession(7, { boost: 1.75, mediaMuted: true, speed: 1.5 }, firstDocument);

		expect(setCalls).toHaveLength(0);
		expect(await getTabControlSession(7, firstDocument)).toEqual({
			volumeBase: 100,
			boost: 1.75,
			mediaMuted: true,
			speed: 1.5,
		});

		await flushTabControlSession(7);
		expect(setCalls).toHaveLength(1);
		expect(values.tab_session_7).toMatchObject({
			version: 2,
			identity: firstDocument,
			patch: {
				volumeBase: 100,
				boost: 1.75,
				mediaMuted: true,
				speed: 1.5,
			},
		});
	});

	test('rebinds every durable acknowledged field across a same-origin refresh', async () => {
		await mergeTabControlSession(7, completeSession, firstDocument);
		expect(await rebindTabControlSession(7, secondDocument)).toEqual(completeSession);
		expect(await getTabControlSession(7, firstDocument)).toBeNull();
		expect(await getTabControlSession(7, secondDocument)).toEqual(completeSession);
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
		expect(controlSessionPatchToAudioConfig(migrated!)).toMatchObject({
			volume: 275,
			volumeBase: 100,
			boost: 2.75,
			muted: true,
			speed: 1.8,
		});
		await flushTabControlSession(7);
		expect(values.tab_session_7).toMatchObject({
			version: 2,
			identity: firstDocument,
			patch: { volumeBase: 100, boost: 2.75, mediaMuted: true, speed: 1.8 },
		});
	});
});
