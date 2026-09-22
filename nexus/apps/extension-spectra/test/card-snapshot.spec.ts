import { describe, expect, test } from 'bun:test';
import { hasKnownBackgroundRetentionInputs, resolveInitialProcessorLifecycle } from '../src/popup/card/snapshot';

describe('field-level card snapshot coverage', () => {
	test.each(['capture', 'bypass'] as const)('uses the newer settled runtime %s before the first card paint', (mode) => {
		const runtime = { actualMode: mode, desiredMode: mode, phase: mode === 'capture' ? 'active' as const : 'idle' as const, generation: 6 };
		const oldMode = mode === 'capture' ? 'bypass' as const : 'capture' as const;
		const session = { actualMode: oldMode, desiredMode: oldMode, phase: oldMode === 'capture' ? 'active' as const : 'idle' as const, generation: 5 };
		expect(resolveInitialProcessorLifecycle(runtime, session)).toBe(runtime);
		expect(resolveInitialProcessorLifecycle(runtime, { ...session, generation: 6 })).toBe(runtime);
		const newerSession = { ...session, generation: 7 };
		expect(resolveInitialProcessorLifecycle(runtime, newerSession)).toBe(newerSession);
		expect(resolveInitialProcessorLifecycle(runtime, null)).toBe(runtime);
	});

	test.each(['starting', 'stopping', 'error'] as const)('does not present runtime %s as an acknowledged final color', (phase) => {
		const runtime = { actualMode: 'capture' as const, desiredMode: 'capture' as const, phase, generation: 6 };
		const session = { actualMode: 'bypass' as const, desiredMode: 'bypass' as const, phase: 'idle' as const, generation: 5 };
		expect(resolveInitialProcessorLifecycle(runtime, session)).toBe(session);
		expect(resolveInitialProcessorLifecycle(runtime, null)).toBeNull();
	});

	test('allows inactive-card eviction only when lifecycle and remote state are both known', () => {
		expect(hasKnownBackgroundRetentionInputs({
			status: { state: 'known', value: {} as never },
			isRemoteActive: { state: 'known', value: false },
		})).toBe(true);
		for (const snapshot of [
			{ status: { state: 'unknown', reason: 'timeout' }, isRemoteActive: { state: 'known', value: false } },
			{ status: { state: 'known', value: {} }, isRemoteActive: { state: 'unknown', reason: 'rejected' } },
		] as const) expect(hasKnownBackgroundRetentionInputs(snapshot as never)).toBe(false);
	});
});
