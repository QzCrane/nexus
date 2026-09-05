import { describe, expect, test } from 'bun:test';
import {
	isSpectraRequestEnvelope,
	isSpectraResponse,
	rpcSuccess,
} from '@nexus/contracts';
import {
	HotkeyTargetRepository,
	type HotkeyTargetStoragePort,
} from '../src/background/hotkey-target-repository';

describe('hotkey target contracts', () => {
	test('accepts only the dedicated exact v2 wire shape', () => {
		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'hotkey-target-get',
			type: 'spectra.hotkey-target.get',
			payload: {},
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'hotkey-target-set',
			type: 'spectra.hotkey-target.set',
			payload: { tabId: 7 },
		})).toBe(true);
		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'hotkey-target-surplus',
			type: 'spectra.hotkey-target.set',
			payload: { tabId: 7, route: 'capture' },
		})).toBe(false);
		expect(isSpectraResponse(
			'spectra.hotkey-target.get',
			rpcSuccess({ tabId: null }),
		)).toBe(true);
		// The v2 site-route wire stays live on its dedicated registry owner; the
		// hotkey-target client only had to stop sharing its transport, which the
		// source-level separation test in ui-contracts.spec.ts pins.
		expect(isSpectraRequestEnvelope({
			protocolVersion: 2,
			requestId: 'retired-route-registry',
			type: 'spectra.registry.get',
			payload: {},
		})).toBe(true);
	});
});

describe('background-owned hotkey target repository', () => {
	test('gets, sets, and clears the target when its tab closes', async () => {
		let stored: unknown;
		const availableTabs = new Set([7]);
		const targetStorage: HotkeyTargetStoragePort = {
			async get() { return stored; },
			async set(tabId) { stored = tabId; },
			async remove() { stored = undefined; },
		};
		const repository = new HotkeyTargetRepository(targetStorage, {
			async get(tabId) {
				if (!availableTabs.has(tabId)) throw new Error('No tab');
				return { id: tabId };
			},
		});

		expect(await repository.set(7)).toEqual({ tabId: 7 });
		expect(await repository.get()).toEqual({ tabId: 7 });
		await repository.clearIfMatches(8);
		expect(await repository.get()).toEqual({ tabId: 7 });
		await repository.clearIfMatches(7);
		expect(await repository.get()).toEqual({ tabId: null });
		await expect(repository.set(0)).rejects.toThrow('positive integer');
	});

	test('drops stale session state after a service worker restart', async () => {
		let stored: unknown = 99;
		const repository = new HotkeyTargetRepository({
			async get() { return stored; },
			async set(tabId) { stored = tabId; },
			async remove() { stored = undefined; },
		}, {
			async get() { throw new Error('No tab'); },
		});
		expect(await repository.get()).toEqual({ tabId: null });
		expect(stored).toBeUndefined();
	});
});
