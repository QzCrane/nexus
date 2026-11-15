// goal: O11 startup projections must not repaint an already acknowledged page-native level
// inv: pure field-merge contract; no browser, network or fixture stand-in
import { describe, expect, test } from 'bun:test';
import type { ControlFieldState, ControlFieldStates } from '@nexus/contracts';
import { preserveAcknowledgedVolumeBase } from '../src/background/control-coordinator-values';

function volume(actual: number | null, phase: 'applied' | 'idle', controlled = false): ControlFieldState<number> {
	return {
		desired: actual,
		actual,
		revision: 7,
		phase,
		strategy: 'dom-native',
		coverage: 'active-target',
		controlled,
		intentId: 'intent-7',
		lastError: null,
	};
}

const acknowledged = (): ControlFieldStates => ({ volumeBase: volume(50, 'applied') });

describe('O11 startup volumeBase publication', () => {
	test('keeps the acknowledged level across a retired idle field', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(null, 'idle') };
		const result = preserveAcknowledgedVolumeBase(acknowledged(), incoming, true, true);
		expect(result.volumeBase?.actual).toBe(50);
		expect(result.volumeBase?.phase).toBe('applied');
	});

	test('keeps the acknowledged level across a new target default of 100', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(100, 'applied') };
		const result = preserveAcknowledgedVolumeBase(acknowledged(), incoming, true, true);
		expect(result.volumeBase?.actual).toBe(50);
	});

	test('publishes a confirmed level arriving from a new target', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(35, 'applied') };
		const result = preserveAcknowledgedVolumeBase(acknowledged(), incoming, true, true);
		expect(result.volumeBase?.actual).toBe(35);
	});

	test('publishes 100 when the selected target did not change', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(100, 'applied') };
		const result = preserveAcknowledgedVolumeBase(acknowledged(), incoming, false, true);
		expect(result.volumeBase?.actual).toBe(100);
	});

	test('leaves non-observation publications untouched', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(null, 'idle') };
		const result = preserveAcknowledgedVolumeBase(acknowledged(), incoming, true, false);
		expect(result.volumeBase?.actual).toBeNull();
	});

	test('does not invent a level when none was acknowledged', () => {
		const incoming: ControlFieldStates = { volumeBase: volume(100, 'applied') };
		const result = preserveAcknowledgedVolumeBase({}, incoming, true, true);
		expect(result.volumeBase?.actual).toBe(100);
	});
});
