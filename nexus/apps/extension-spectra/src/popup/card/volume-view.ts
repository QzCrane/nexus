// goal: sole DOM writer for a tab card's volume projection
//
// The slider fill, the readout and the native thumb are one projection of one
// value. When two modules write them, the one that runs last wins silently and
// the disagreement shows up as a flicker or a bar that trails the thumb. Both
// the frame-coalesced reconciliation and the synchronous pointer path therefore
// go through this module, which is what lets `check-ui-authority` assert a
// single writer mechanically instead of trusting review.

import { AUDIO_UI } from '../constants';
import type { CardUIElements } from '../types';

export interface VolumeProjection {
	/** Displayed value on the card's 0..MAX_VOLUME scale. */
	readonly value: number;
	readonly color: string;
	readonly muted: boolean;
	/**
	 * Native thumb position. `null` hands the thumb to the browser, which owns
	 * it for the duration of a drag: writing it back mid-gesture pulls the
	 * control out from under the pointer.
	 */
	readonly thumb: number | null;
}

/** Parse/binding presentation has no physical value yet; this is the same writer. */
export function showUnknownVolume(ui: Pick<CardUIElements, 'val'>): void {
	ui.val.textContent = '—';
}

export interface VolumeView {
	/** Full reconciliation of thumb, fill, readout and tone. */
	commit(projection: VolumeProjection): void;
	/**
	 * Synchronous, state-free fast path used inside the input handler so the bar
	 * cannot trail the pointer while a full render is still pending. It paints
	 * only what the gesture itself determines and leaves tone to `commit`.
	 */
	paintPointer(value: number, color?: string): void;
	/**
	 * Move the native thumb for a gesture the browser does not drive itself, such
	 * as a wheel step. Still one direction only: state -> DOM.
	 */
	setThumb(value: number): void;
}

function percentage(value: number): string {
	const bounded = Math.max(0, Math.min(AUDIO_UI.MAX_VOLUME, value));
	return `${(bounded / AUDIO_UI.MAX_VOLUME) * 100}%`;
}

// Readouts keep a single decimal only when the value actually carries one, so a
// stepped 0..800 gesture never renders as "40.0".
function formatVolume(volume: number): string {
	return Number.isInteger(volume) ? String(volume) : volume.toFixed(1).replace(/\.0$/u, '');
}

export function createVolumeView(ui: Pick<CardUIElements, 'slider' | 'fill' | 'val'>): VolumeView {
	// Written on every frame during a drag; cheap equality guards keep repeated
	// identical writes from churning layout.
	let lastWidth = '';
	let lastLabel = '';
	let lastColor = '';
	let lastThumb = '';

	const writeWidth = (width: string): void => {
		if (width === lastWidth) return;
		lastWidth = width;
		ui.fill.style.width = width;
	};
	const writeLabel = (label: string): void => {
		if (label === lastLabel) return;
		lastLabel = label;
		ui.val.textContent = label;
	};
	const writeColor = (color: string): void => {
		if (color === lastColor) return;
		lastColor = color;
		ui.fill.style.backgroundColor = color;
		ui.val.style.color = color;
		ui.slider?.style?.setProperty?.('--slider-accent', color);
	};
	const writeThumb = (value: number): void => {
		const next = String(value);
		if (next === lastThumb) return;
		lastThumb = next;
		ui.slider.value = next;
	};

	return {
		commit(projection: VolumeProjection): void {
			if (projection.thumb !== null) writeThumb(projection.thumb);
			writeWidth(percentage(projection.value));
			writeLabel(projection.muted ? 'MUTE' : `${formatVolume(projection.value)}%`);
			writeColor(projection.color);
		},
		paintPointer(value: number, color?: string): void {
			if (!Number.isFinite(value)) return;
			writeWidth(percentage(value));
			writeLabel(`${formatVolume(value)}%`);
			// The tone follows the gesture only when the caller knows the route it
			// is painting; the renderer's `commit` remains the single tone owner
			// for every non-gesture update.
			if (color !== undefined) writeColor(color);
		},
		setThumb(value: number): void {
			if (!Number.isFinite(value)) return;
			writeThumb(value);
		},
	};
}
