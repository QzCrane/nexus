import { beforeEach, describe, expect, test } from 'bun:test';
import type { TabSessionIdentity } from '@nexus/contracts';

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
	flushTabSessionConfig,
	getTabSessionConfig,
	removeTabSessionConfig,
	setTabSessionConfig,
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

beforeEach(async () => {
	await removeTabSessionConfig(7);
	for (const key of Object.keys(values)) delete values[key];
	setCalls.length = 0;
});

describe('document-bound tab sessions', () => {
	test('does not leak settings into a different document', async () => {
		await setTabSessionConfig(7, { volume: 250 }, firstDocument);
		expect(await getTabSessionConfig(7, firstDocument)).toMatchObject({
			volume: 250,
			volumeBase: 100,
			boost: 2.5,
		});
		expect(await getTabSessionConfig(7, secondDocument)).toBeNull();

		await setTabSessionConfig(7, { muted: true }, secondDocument);
		const second = await getTabSessionConfig(7, secondDocument);
		expect(second?.volume).toBe(100);
		expect(second?.muted).toBe(true);
		expect(await getTabSessionConfig(7, firstDocument)).toBeNull();
	});

	test('discards unidentifiable legacy tabId-only entries', async () => {
		values.tab_session_7 = { volume: 400 };
		expect(await getTabSessionConfig(7, firstDocument)).toBeNull();
		expect(values.tab_session_7).toBeUndefined();
	});

	test('coalesces rapid session updates and exposes a lifecycle flush', async () => {
		await setTabSessionConfig(7, { volume: 150 }, firstDocument);
		await setTabSessionConfig(7, { volume: 175, muted: true }, firstDocument);

		expect(setCalls).toHaveLength(0);
		expect(await getTabSessionConfig(7, firstDocument)).toMatchObject({
			volume: 175,
			volumeBase: 100,
			boost: 1.75,
			muted: true,
		});

		await flushTabSessionConfig(7);
		expect(setCalls).toHaveLength(1);
		expect(values.tab_session_7).toMatchObject({
			identity: firstDocument,
			config: { volume: 175, muted: true },
		});
	});
});
