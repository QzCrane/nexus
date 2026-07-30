import { describe, expect, test } from 'bun:test';
import {
	normalizeUnschematizedToolState,
	UseToolStateLifecycleEpoch,
	UseToolStatePendingAuthority,
} from '../src/kernel/hooks/use-tool-state';
import {
	DEFAULT_FILTER_CONFIG,
	normalizeFilterConfig,
	normalizeScanResult,
} from '../src/tools/media-sniffer/types';

function jsonStorageModelRoundTrip(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

describe('HALO storage boundaries', () => {
	test('external authority cancels debounced and queued unmount writes', () => {
		const cancelledTimers: unknown[] = [];
		const authority = new UseToolStatePendingAuthority(
			{ source: 'initial' },
			undefined,
			(timer) => cancelledTimers.push(timer),
		);
		const local = authority.stageLocal({ source: 'local' });
		const timer = { id: 'debounce' } as unknown as ReturnType<typeof setTimeout>;
		authority.attachPendingTimer(local.token, timer);

		const external = authority.observeStorage({ source: 'external' });

		expect(external).toEqual({
			kind: 'external',
			value: { source: 'external' },
		});
		expect(cancelledTimers).toEqual([timer]);
		expect(authority.flushPending()).toBe(false);
		expect(authority.beginNextWrite()).toBeNull();

		const queued = authority.stageLocal({ source: 'queued-before-unmount' });
		expect(authority.flushPending(queued.token)).toBe(true);
		authority.observeStorage({ source: 'newer-external' });
		expect(authority.beginNextWrite()).toBeNull();
	});

	test('own write echoes before resolution preserve a newer local pending value', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const firstIntent = authority.stageLocal({ value: 'first' });
		expect(authority.flushPending(firstIntent.token)).toBe(true);
		const first = authority.beginNextWrite();
		if (!first) throw new Error('First write was not queued');

		const newer = authority.stageLocal({ value: 'newer' });
		expect(authority.observeStorage({ value: 'first' })).toEqual({
			kind: 'own-echo',
		});

		expect(authority.flushPending(newer.token)).toBe(true);
		authority.completeWrite(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'newer' });
	});

	test('a delayed own echo after resolution preserves newer local pending', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const first = authority.stageLocal({ value: 'first' });
		expect(authority.flushPending(first.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'first' });
		authority.completeWrite(true);

		const newer = authority.stageLocal({ value: 'newer' });
		expect(authority.observeStorage({ value: 'first' })).toEqual({
			kind: 'own-echo',
		});
		expect(authority.flushPending(newer.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'newer' });
	});

	test('a real external transition invalidates older no-op write echo fences', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'old-own-write' });
		const noOp = authority.stageLocal({ value: 'old-own-write' });
		expect(authority.flushPending(noOp.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'old-own-write' });
		authority.completeWrite(true);

		const active = authority.stageLocal({ value: 'active-own-write' });
		expect(authority.flushPending(active.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'active-own-write' });
		expect(authority.observeStorage({ value: 'external-winner' })).toEqual({
			kind: 'external',
			value: { value: 'external-winner' },
		});
		expect(authority.observeStorage({ value: 'active-own-write' })).toEqual({
			kind: 'own-echo',
		});

		const pending = authority.stageLocal({ value: 'pending-local' });
		expect(authority.observeStorage({ value: 'old-own-write' })).toEqual({
			kind: 'external',
			value: { value: 'old-own-write' },
		});
		expect(authority.flushPending(pending.token)).toBe(false);
	});

	test('repairs an in-flight stale completion with the external winner', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const staleIntent = authority.stageLocal({ value: 'stale-local' });
		expect(authority.flushPending(staleIntent.token)).toBe(true);
		const stale = authority.beginNextWrite();
		if (!stale) throw new Error('Stale write was not queued');

		expect(authority.observeStorage({ value: 'external-winner' })).toEqual({
			kind: 'external',
			value: { value: 'external-winner' },
		});
		expect(authority.observeStorage({ value: 'stale-local' })).toEqual({
			kind: 'own-echo',
		});

		authority.completeWrite(true);
		const repair = authority.beginNextWrite();
		expect(repair?.value).toEqual({ value: 'external-winner' });
		expect(authority.observeStorage({ value: 'external-winner' })).toEqual({
			kind: 'own-echo',
		});
		authority.completeWrite(true);
		expect(authority.beginNextWrite()).toBeNull();
	});

	test('delayed initial reads cannot replace a newer external authority', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const requestedRevision = authority.authorityRevision;

		authority.observeStorage({ value: 'external' });

		expect(
			authority.acceptLoaded({ value: 'stale-read' }, requestedRevision),
		).toBe(false);
	});

	test('coalesces external b then c while an older write is active', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const stale = authority.stageLocal({ value: 'a' });
		expect(authority.flushPending(stale.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'a' });

		authority.observeStorage({ value: 'b' });
		authority.observeStorage({ value: 'c' });
		authority.completeWrite(true);

		expect(authority.beginNextWrite()?.value).toEqual({ value: 'c' });
	});

	test('repairs external c after an external b repair was already active', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const stale = authority.stageLocal({ value: 'a' });
		expect(authority.flushPending(stale.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'a' });

		authority.observeStorage({ value: 'b' });
		authority.completeWrite(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'b' });

		authority.observeStorage({ value: 'c' });
		authority.completeWrite(true);

		expect(authority.beginNextWrite()?.value).toEqual({ value: 'c' });
	});

	test('external b followed by local c repairs only local c', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const stale = authority.stageLocal({ value: 'a' });
		expect(authority.flushPending(stale.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'a' });

		authority.observeStorage({ value: 'b' });
		const current = authority.stageLocal({ value: 'c' });
		authority.completeWrite(true);
		expect(authority.beginNextWrite()).toBeNull();

		expect(authority.flushPending(current.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'c' });
	});

	test('coalesces local a and b into the final unmount write', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		authority.stageLocal({ value: 'a' });
		const latest = authority.stageLocal({ value: 'b' });

		expect(authority.flushPending(latest.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'b' });
	});

	test('active plus pending unmount keeps one active and one latest desired', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const active = authority.stageLocal({ value: 'a' });
		expect(authority.flushPending(active.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'a' });

		const pending = authority.stageLocal({ value: 'b' });
		expect(authority.flushPending(pending.token)).toBe(true);
		expect(authority.beginNextWrite()).toBeNull();
		authority.completeWrite(true);

		expect(authority.beginNextWrite()?.value).toEqual({ value: 'b' });
	});

	test('active a failure preserves an already desired b write', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const active = authority.stageLocal({ value: 'a' });
		expect(authority.flushPending(active.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'a' });

		const desired = authority.stageLocal({ value: 'b' });
		expect(authority.flushPending(desired.token)).toBe(true);
		expect(authority.beginNextWrite()).toBeNull();
		authority.completeWrite(false);

		expect(authority.beginNextWrite()?.value).toEqual({ value: 'b' });
	});

	test('a sealed hook epoch rejects retained setters without a timer or write', () => {
		const lifecycle = new UseToolStateLifecycleEpoch();
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const attachedTimers: unknown[] = [];
		let stateMutations = 0;

		const retainedSave = (value: { value: string }): boolean =>
			lifecycle.runIfAccepting(() => {
				const request = authority.stageLocal(value);
				const timer = { id: request.token } as unknown as ReturnType<typeof setTimeout>;
				attachedTimers.push(timer);
				authority.attachPendingTimer(request.token, timer);
			});
		const retainedSetter = (value: { value: string }): boolean =>
			lifecycle.runIfAccepting(() => {
				stateMutations++;
				retainedSave(value);
			});

		lifecycle.open();
		lifecycle.seal();

		expect(retainedSetter({ value: 'after-unmount' })).toBe(false);
		expect(retainedSave({ value: 'after-unmount' })).toBe(false);
		expect(stateMutations).toBe(0);
		expect(attachedTimers).toEqual([]);
		expect(authority.flushPending()).toBe(false);
		expect(authority.beginNextWrite()).toBeNull();
	});

	test('separates key and area controller epochs', () => {
		const oldEpoch = new UseToolStatePendingAuthority({ value: 'old' });
		const old = oldEpoch.stageLocal({ value: 'old-write' });
		expect(oldEpoch.flushPending(old.token)).toBe(true);
		expect(oldEpoch.beginNextWrite()?.value).toEqual({ value: 'old-write' });

		const newEpoch = new UseToolStatePendingAuthority({ value: 'new' });
		const current = newEpoch.stageLocal({ value: 'new-write' });
		oldEpoch.completeWrite(true);

		expect(newEpoch.flushPending(current.token)).toBe(true);
		expect(newEpoch.beginNextWrite()?.value).toEqual({ value: 'new-write' });
		expect(oldEpoch.beginNextWrite()).toBeNull();
	});

	test('a failed set neither repairs nor loops', () => {
		const authority = new UseToolStatePendingAuthority({ value: 'initial' });
		const active = authority.stageLocal({ value: 'local' });
		expect(authority.flushPending(active.token)).toBe(true);
		expect(authority.beginNextWrite()?.value).toEqual({ value: 'local' });
		authority.observeStorage({ value: 'external' });

		authority.completeWrite(false);

		expect(authority.beginNextWrite()).toBeNull();
	});

	test('media filters survive a Chrome-compatible write and readback', () => {
		const filter = normalizeFilterConfig({
			types: ['video', 'audio', 'video'],
			minSize: 1024,
			includeDataUrls: true,
		});
		const readback = normalizeFilterConfig(jsonStorageModelRoundTrip(filter));

		expect(readback).toEqual({
			types: ['video', 'audio'],
			minSize: 1024,
			includeDataUrls: true,
		});
		expect(readback.types.includes('video')).toBe(true);
	});

	test('repairs the legacy Set serialization failure instead of exposing an object', () => {
		const legacyReadback = jsonStorageModelRoundTrip({
			types: new Set(['video', 'audio', 'image']),
			minSize: 0,
			includeDataUrls: false,
		});

		expect(normalizeFilterConfig(legacyReadback)).toEqual(DEFAULT_FILTER_CONFIG);
	});

	test('rejects non-JSON local updates before they reach Chrome storage', () => {
		const fallback = { values: ['safe'] };

		expect(
			normalizeUnschematizedToolState({ values: new Set(['unsafe']) }, fallback),
		).toBe(fallback);
	});

	test('rejects values whose JSON storage roundtrip changes their own data', () => {
		const arrayFallback = ['safe'];
		const sparse = new Array<string>(1);
		const recordFallback = { enabled: false };

		expect(normalizeUnschematizedToolState(sparse, arrayFallback))
			.toBe(arrayFallback);
		expect(
			normalizeUnschematizedToolState({ enabled: undefined }, recordFallback),
		).toBe(recordFallback);

		const withSymbol = { enabled: true };
		Object.defineProperty(withSymbol, Symbol('hidden'), {
			value: 'not serialized',
			enumerable: true,
		});
		expect(normalizeUnschematizedToolState(withSymbol, recordFallback))
			.toBe(recordFallback);
	});

	test('leaves field schema repair to the domain normalizer', () => {
		const fallback = { enabled: false };
		const wrongSchema = { enabled: 'yes' };

		expect(normalizeUnschematizedToolState(wrongSchema, fallback))
			.toBe(wrongSchema);
	});

	test('rejects malformed persisted scan results', () => {
		expect(normalizeScanResult({ items: {}, timestamp: 1, url: 'https://example.test' }))
			.toBeNull();
		expect(normalizeScanResult({
			items: [{
				id: 'media-1',
				url: 'https://example.test/video.mp4',
				type: 'video',
				ext: 'mp4',
				size: Number.POSITIVE_INFINITY,
				source: 'video',
				sizeText: '?',
			}],
			timestamp: 1,
			url: 'https://example.test',
		})).toBeNull();
		expect(normalizeScanResult({
			items: [],
			timestamp: Number.NaN,
			url: 'https://example.test',
		})).toBeNull();
	});
});
