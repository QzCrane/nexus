import { describe, expect, test } from 'bun:test';
import {
	DeadlineExceededError,
	RPC_DEADLINE_MS,
	withDeadline,
} from '../src/shared/timeout';

describe('cross-context deadline', () => {
	test('resolves with the underlying value when it settles in time', async () => {
		await expect(withDeadline(Promise.resolve(42), 1_000, 'probe')).resolves.toBe(42);
	});

	test('rejects with DeadlineExceededError when the call never settles', async () => {
		const never = new Promise<never>(() => undefined);
		const error = await withDeadline(never, 20, 'hung rpc').catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(DeadlineExceededError);
		expect((error as DeadlineExceededError).label).toBe('hung rpc');
		expect((error as DeadlineExceededError).timeoutMs).toBe(20);
	});

	test('propagates the original rejection instead of masking it as a timeout', async () => {
		const boom = new Error('content host gone');
		const error = await withDeadline(Promise.reject(boom), 1_000, 'rpc').catch((cause: unknown) => cause);
		expect(error).toBe(boom);
	});

	test('a settled call leaves no pending timer behind', async () => {
		// If the timer were left armed, the Service Worker would stay alive for the
		// full budget after every successful RPC.
		const before = process.getActiveResourcesInfo?.().filter((name) => name === 'Timeout').length ?? 0;
		for (let index = 0; index < 25; index += 1) {
			await withDeadline(Promise.resolve(index), 60_000, `probe-${index}`);
		}
		const after = process.getActiveResourcesInfo?.().filter((name) => name === 'Timeout').length ?? 0;
		expect(after).toBeLessThanOrEqual(before);
	});

	test('refuses a non-positive budget instead of silently disabling the guard', () => {
		expect(() => withDeadline(Promise.resolve(1), 0, 'bad')).toThrow(RangeError);
		expect(() => withDeadline(Promise.resolve(1), Number.POSITIVE_INFINITY, 'bad')).toThrow(RangeError);
	});

	test('every declared budget is finite and positive', () => {
		for (const budget of Object.values(RPC_DEADLINE_MS)) {
			expect(Number.isFinite(budget)).toBe(true);
			expect(budget).toBeGreaterThan(0);
		}
	});
});
