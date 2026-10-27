import { describe, expect, test } from 'bun:test';
import { createVolumeView } from '../src/popup/card/volume-view';
import { AUDIO_UI } from '../src/popup/constants';
import { COLORS } from '../src/popup/constants';

interface WriteCounts {
	width: number;
	label: number;
	color: number;
	thumb: number;
}

/**
 * A recording stand-in for the card's volume elements. `volume-view` is the sole
 * writer of these three nodes, so counting real writes is the only way to prove
 * the equality guards suppress churn without ever suppressing a real change.
 */
function installVolumeElements(): {
	ui: Parameters<typeof createVolumeView>[0];
	counts: WriteCounts;
	state: { width: string; label: string; color: string; thumb: string };
} {
	const counts: WriteCounts = { width: 0, label: 0, color: 0, thumb: 0 };
	const state = { width: '', label: '', color: '', thumb: '' };
	const fill = {
		style: {
			set width(next: string) { counts.width += 1; state.width = next; },
			get width(): string { return state.width; },
			set backgroundColor(next: string) { state.color = next; },
			get backgroundColor(): string { return state.color; },
		},
	};
	const val = {
		style: {
			set color(next: string) { state.color = next; },
			get color(): string { return state.color; },
		},
		set textContent(next: string) { counts.label += 1; state.label = next; },
		get textContent(): string { return state.label; },
	};
	const slider = {
		set value(next: string) { counts.thumb += 1; state.thumb = next; },
		get value(): string { return state.thumb; },
	};
	return {
		ui: { slider, fill, val } as unknown as Parameters<typeof createVolumeView>[0],
		counts,
		state,
	};
}

const NATIVE_COLOR = COLORS.NATIVE;

describe('card volume projection (single writer)', () => {
	test('commit paints fill, readout, tone and thumb together', () => {
		const { ui, state } = installVolumeElements();
		const view = createVolumeView(ui);
		view.commit({ value: 200, color: NATIVE_COLOR, muted: false, thumb: 200 });
		expect(state.width).toBe(`${(200 / AUDIO_UI.MAX_VOLUME) * 100}%`);
		expect(state.label).toBe('200%');
		expect(state.thumb).toBe('200');
	});

	test('paintPointer moves the bar without touching tone or thumb', () => {
		const { ui, counts, state } = installVolumeElements();
		const view = createVolumeView(ui);
		view.commit({ value: 40, color: NATIVE_COLOR, muted: false, thumb: 40 });
		const thumbAfterCommit = counts.thumb;
		view.paintPointer(300);
		expect(state.width).toBe(`${(300 / AUDIO_UI.MAX_VOLUME) * 100}%`);
		expect(state.label).toBe('300%');
		// The gesture owns the thumb; only a browser-driven gesture may move it.
		expect(counts.thumb).toBe(thumbAfterCommit);
	});

	test('a muted readout wins over the pointer value', () => {
		const { ui, state } = installVolumeElements();
		const view = createVolumeView(ui);
		view.commit({ value: 120, color: NATIVE_COLOR, muted: true, thumb: 120 });
		expect(state.label).toBe('MUTE');
	});

	test('equality guards suppress churn but never a real change', () => {
		const { ui, counts, state } = installVolumeElements();
		const view = createVolumeView(ui);
		view.commit({ value: 40, color: NATIVE_COLOR, muted: false, thumb: 40 });
		expect(counts.width).toBe(1);
		view.commit({ value: 40, color: NATIVE_COLOR, muted: false, thumb: 40 });
		expect(counts.width).toBe(1);
		view.commit({ value: 41, color: NATIVE_COLOR, muted: false, thumb: 41 });
		expect(counts.width).toBe(2);
		expect(state.label).toBe('41%');
	});

	test('clamps the fill instead of overflowing the rail', () => {
		const { ui, state } = installVolumeElements();
		const view = createVolumeView(ui);
		view.paintPointer(AUDIO_UI.MAX_VOLUME * 4);
		expect(state.width).toBe('100%');
		view.paintPointer(-50);
		expect(state.width).toBe('0%');
	});

	test('ignores a non-finite pointer value', () => {
		const { ui, counts } = installVolumeElements();
		const view = createVolumeView(ui);
		view.paintPointer(Number.NaN);
		expect(counts.width).toBe(0);
	});
});
