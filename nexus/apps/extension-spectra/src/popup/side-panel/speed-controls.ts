/**
 * SPECTRA Popup - Side Panel Speed Controls
 */

import { sendToTab } from '../utils/dom';

interface SpeedControls {
	speedSlider: HTMLInputElement | null;
	speedInput: HTMLInputElement | null;
}

/** Helper: Add wheel support */
export function addWheelSupport(
	slider: HTMLInputElement | null,
	step: number,
	min: number,
	max: number,
	onUpdate: (value: number) => void
): void {
	if (!slider) return;
	slider.addEventListener('wheel', (e) => {
		e.preventDefault();
		let v = parseFloat(slider.value);
		v = e.deltaY < 0 ? Math.min(v + step, max) : Math.max(v - step, min);
		slider.value = String(v);
		onUpdate(v);
	}, { passive: false });
}

export function bindSpeedControls(c: SpeedControls, tabId: number): void {
	const updateSpeed = async (speed: number) => {
		const clampedSpeed = Math.max(0.25, Math.min(16, speed));
		const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: clampedSpeed });
		if (res) {
			if (c.speedSlider) c.speedSlider.value = String(res.speed);
			if (c.speedInput) c.speedInput.value = res.speed.toFixed(2);
			syncCardSpeedInput(res.speed);
		}
	};

	if (c.speedSlider) {
		c.speedSlider.value = '1';
		c.speedSlider.oninput = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value);
			if (c.speedInput) c.speedInput.value = speed.toFixed(2);
		};
		c.speedSlider.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value);
			updateSpeed(speed);
		};
		addWheelSupport(c.speedSlider, 0.05, 0.25, 16, updateSpeed);
	}

	if (c.speedInput) {
		c.speedInput.value = '1.00';
		c.speedInput.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value) || 1;
			updateSpeed(speed);
		};
		c.speedInput.addEventListener('wheel', (e) => {
			e.preventDefault();
			const current = parseFloat(c.speedInput!.value) || 1;
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			const newSpeed = Math.max(0.25, Math.min(16, current + delta));
			c.speedInput!.value = newSpeed.toFixed(2);
			if (c.speedSlider) c.speedSlider.value = String(newSpeed);
			updateSpeed(newSpeed);
		}, { passive: false });
	}
}

/** Sync card input from side panel */
function syncCardSpeedInput(speed: number): void {
	const cardInputs = document.querySelectorAll('.speed-input') as NodeListOf<HTMLInputElement>;
	cardInputs.forEach(inp => inp.value = speed.toFixed(2));
}

/** Sync speed display (export for external use) */
export function syncSidePanelSpeed(speed: number): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;
	const slider = panel.querySelector('.sp-speed-slider') as HTMLInputElement | null;
	const input = panel.querySelector('.sp-speed-input') as HTMLInputElement | null;
	if (slider) slider.value = String(speed);
	if (input) input.value = speed.toFixed(2);
}
