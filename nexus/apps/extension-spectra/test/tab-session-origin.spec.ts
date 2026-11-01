// goal: verify cross-tab, same-origin retention of origin-portable adjustments
// note: a brand-new tab on an origin inherits adjustments made in another tab

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { storage } from '../src/background/state';
import { runtimeLoaderTestApi } from '../src/background/runtime-loader';
import { settingsRepository } from '../src/background/settings-repository';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';

const store = new Map<string, unknown>();
const chromeMock = {
	storage: {
		session: {
			get: async (keys: string | string[] | null) => {
				if (keys === null) return Object.fromEntries(store.entries());
				const list = Array.isArray(keys) ? keys : [keys];
				const out: Record<string, unknown> = {};
				for (const k of list) out[k] = store.get(k);
				return out;
			},
			set: async (values: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(values)) store.set(k, v);
			},
			remove: async (keys: string | string[]) => {
				const list = Array.isArray(keys) ? keys : [keys];
				for (const k of list) store.delete(k);
			},
		},
	},
};

let savedChrome: typeof globalThis.chrome | undefined;
let savedRebind: typeof storage.tabSession.rebind;
let savedResolve: typeof settingsRepository.resolveAudioConfig;

beforeEach(() => {
	store.clear();
	savedChrome = globalThis.chrome;
	globalThis.chrome = chromeMock as unknown as typeof globalThis.chrome;
	savedRebind = storage.tabSession.rebind;
	savedResolve = settingsRepository.resolveAudioConfig;
});

afterEach(() => {
	globalThis.chrome = savedChrome as typeof globalThis.chrome;
	storage.tabSession.rebind = savedRebind;
	settingsRepository.resolveAudioConfig = savedResolve;
});

describe('cross-tab origin session retention', () => {
	test('an origin-portable merge propagates to the origin session', async () => {
		const idA = storage.tabSession.identity(1, 'doc-1', 'https://example.com/watch');
		await storage.tabSession.merge(1, { volumeBase: 50 }, idA, 'origin');
		expect(await storage.originSession.get('https://example.com')).toEqual({ volumeBase: 50 });
	});

	test('a resource-scoped merge does not propagate to the origin session', async () => {
		const idA = storage.tabSession.identity(1, 'doc-1', 'https://example.com/watch');
		await storage.tabSession.merge(1, { volumeBase: 80 }, idA, 'resource');
		expect(await storage.originSession.get('https://example.com')).toBeNull();
	});

	test('multiple tabs on the same origin union-merge their adjustments', async () => {
		const idA = storage.tabSession.identity(1, 'doc-1', 'https://example.com/watch');
		const idB = storage.tabSession.identity(2, 'doc-2', 'https://example.com/video');
		await storage.tabSession.merge(1, { volumeBase: 50 }, idA, 'origin');
		await storage.tabSession.merge(2, { boost: 2 }, idB, 'origin');
		expect(await storage.originSession.get('https://example.com'))
			.toEqual({ volumeBase: 50, boost: 2 });
	});

	test('a later same-origin adjustment overrides the prior value', async () => {
		const idA = storage.tabSession.identity(1, 'doc-1', 'https://example.com/watch');
		const idB = storage.tabSession.identity(2, 'doc-2', 'https://example.com/video');
		await storage.tabSession.merge(1, { volumeBase: 50 }, idA, 'origin');
		await storage.tabSession.merge(2, { volumeBase: 90 }, idB, 'origin');
		expect(await storage.originSession.get('https://example.com')).toEqual({ volumeBase: 90 });
	});

	test('a fresh same-origin tab inherits the origin baseline layered on the preset', async () => {
		// Tab A adjusts volume on the origin; this seeds the origin session.
		const idA = storage.tabSession.identity(1, 'doc-1', 'https://example.com/watch');
		await storage.tabSession.merge(1, { volumeBase: 62 }, idA, 'origin');

		// Tab B is brand new on the same origin with no per-tab session.
		storage.tabSession.rebind = async () => null;
		settingsRepository.resolveAudioConfig = async () => ({
			...DEFAULT_AUDIO_CONFIG,
			boost: 1.5,
		});

		const plan = await runtimeLoaderTestApi.resolveDocumentRestorePlan(
			7,
			'document-7',
			'https://example.com/fresh',
		);
		// Origin override (volumeBase:62) wins; preset-only field (boost:1.5) remains.
		expect(plan.source).toBe('session');
		expect(plan.patch.volumeBase).toBe(62);
		expect(plan.patch.boost).toBe(1.5);
	});

	test('without an origin baseline a fresh tab falls back to the preset', async () => {
		storage.tabSession.rebind = async () => null;
		settingsRepository.resolveAudioConfig = async () => ({
			...DEFAULT_AUDIO_CONFIG,
			boost: 2,
		});
		const plan = await runtimeLoaderTestApi.resolveDocumentRestorePlan(
			7,
			'document-7',
			'https://other.example/fresh',
		);
		expect(plan.source).toBe('preset');
		expect(plan.patch.boost).toBe(2);
		expect(plan.patch.volumeBase).toBe(100);
	});
});
