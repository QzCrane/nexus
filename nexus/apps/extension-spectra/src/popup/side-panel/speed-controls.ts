// goal: manages video playback speed controls in the side panel with cross-card synchronization

import type { AudioConfig } from '@nexus/kernel';
import { CONTROL_VALUE_LIMITS, clampControlValue } from '@nexus/contracts/ui-runtime';
import { getCurrentPanelTabId } from './panel-session';
import { parseFiniteControlInput } from '../utils/control-input';

const SPEED_MIN = CONTROL_VALUE_LIMITS.speed.min;
const SPEED_MAX = CONTROL_VALUE_LIMITS.speed.max;

function clampSpeed(value: number): number {
	return clampControlValue(value, 'speed', 1);
}

interface SpeedControls {
	speedSlider: HTMLInputElement | null;
	speedInput: HTMLInputElement | null;
}

// eff: attaches a wheel listener to a numeric slider or input, enabling high-precision adjustments with defined steps and bounds
export function addWheelSupport(
	slider: HTMLInputElement | null,
	step: number,
	min: number,
	max: number,
	onUpdate: (value: number) => void
): void {
	if (!slider) return;
	// note: passive: false is required to support preventDefault() and block page scrolling during adjustment
	slider.onwheel = (e) => {
		e.preventDefault();
		let v = parseFloat(slider.value);
		v = e.deltaY < 0 ? Math.min(v + step, max) : Math.max(v - step, min);
		slider.value = String(v);
		onUpdate(v);
	};
}

// eff: binds side panel speed slider and input to the update function, using unified config flow
// note: speed now uses same update flow as volume - through updateFn instead of direct MEDIA_SET_SPEED
export function bindSpeedControls(c: SpeedControls, updateFn: (changes: Partial<AudioConfig>) => void, initialSpeed: number = 1): void {
	const updateSpeed = (speed: number) => {
		const clampedSpeed = clampSpeed(speed);
		if (c.speedSlider) c.speedSlider.value = String(clampedSpeed);
		if (c.speedInput) c.speedInput.value = clampedSpeed.toFixed(2);
		updateFn({ speed: clampedSpeed });
	};
	const normalizedInitialSpeed = clampSpeed(initialSpeed);

	if (c.speedSlider) {
		c.speedSlider.value = String(normalizedInitialSpeed);
		c.speedSlider.oninput = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value);
			if (c.speedInput) c.speedInput.value = speed.toFixed(2);
		};
		c.speedSlider.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value);
			updateSpeed(speed);
		};
		addWheelSupport(c.speedSlider, 0.05, SPEED_MIN, SPEED_MAX, updateSpeed);
	}

	const speedInput = c.speedInput;
	if (speedInput) {
		speedInput.value = normalizedInitialSpeed.toFixed(2);
		speedInput.onchange = (e) => {
			updateSpeed(parseFiniteControlInput((e.target as HTMLInputElement).value, 1));
		};
		speedInput.onwheel = (e) => {
			e.preventDefault();
			const current = parseFiniteControlInput(speedInput.value, 1);
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			const newSpeed = clampSpeed(current + delta);
			speedInput.value = newSpeed.toFixed(2);
			if (c.speedSlider) c.speedSlider.value = String(newSpeed);
			updateSpeed(newSpeed);
		};
	}
}

// eff: updates the side panel speed UI elements when the value is changed elsewhere (e.g. from the main card or content script sync)
export function syncSidePanelSpeed(tabId: number, speed: number): void {
	if (getCurrentPanelTabId() !== tabId) return;
	const panel = document.getElementById('side-panel');
	if (!panel) return;
	const normalizedSpeed = clampSpeed(speed);
	const slider = panel.querySelector('.sp-speed-slider') as HTMLInputElement | null;
	const input = panel.querySelector('.sp-speed-input') as HTMLInputElement | null;
	if (slider && document.activeElement !== slider) slider.value = String(normalizedSpeed);
	if (input && document.activeElement !== input) input.value = normalizedSpeed.toFixed(2);
}
