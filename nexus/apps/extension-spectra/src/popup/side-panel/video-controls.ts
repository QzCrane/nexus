// goal: binds interactive video manipulation controls (filters, transforms, A/B loops) in the side panel to content script actions

import { requestTab } from '../utils/dom';

let currentTabId: number | null = null;

// eff: sets the target tab for all subsequent video control commands
export function setVideoControlTabId(tabId: number): void {
	currentTabId = tabId;
}

// eff: identifies and initializes all video-related UI components within the side panel container
export function bindVideoControls(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	bindButtons(panel);
	bindFilterSliders(panel);
	bindFilterSwitches(panel);
	bindSeekButtons(panel);
}

// note: handles discrete action buttons like rotation, mirroring, and A/B marker placement via a centralized switch
function bindButtons(panel: HTMLElement): void {
	const btns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn[data-action]');

	btns.forEach(btn => {
		const action = btn.dataset.action;
		if (!action) return;
		if (['mirror', 'crop', 'fullscreen', 'dim', 'mark-a', 'mark-b'].includes(action)) {
			btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
		}

		btn.onclick = async () => {
			if (!currentTabId) return;

			switch (action) {
				case 'rotate': {
					const res = await requestTab(currentTabId, 'spectra.video.rotate', { delta: 90 });
					if (res) btn.title = `Rotation: ${res.rotation}°`;
					break;
				}
				case 'mirror': {
					const res = await requestTab(currentTabId, 'spectra.video.mirror.toggle', {});
					if (res) setPressed(btn, res.mirrored);
					break;
				}
				case 'screenshot': {
					// note: triggering a screenshot typically involves content script capturing the video element into a canvas
					await requestTab(currentTabId, 'spectra.video.screenshot', {});
					break;
				}
				case 'crop': {
					const res = await requestTab(currentTabId, 'spectra.video.crop.toggle', {});
					if (res) setPressed(btn, res.cropped);
					break;
				}
				case 'fullscreen': {
					const res = await requestTab(currentTabId, 'spectra.video.fullscreen.toggle', {});
					if (res) setPressed(btn, res.active);
					break;
				}
				case 'dim': {
					const res = await requestTab(currentTabId, 'spectra.video.dim.toggle', {});
					if (res) setPressed(btn, res.active);
					break;
				}
				case 'mark-a': {
					await requestTab(currentTabId, 'spectra.video.ab.a.set', {});
					setPressed(btn, true);
					break;
				}
				case 'mark-b': {
					await requestTab(currentTabId, 'spectra.video.ab.b.set', {});
					setPressed(btn, true);
					break;
				}
				case 'ab-loop': {
					// note: reset both A and B markers globally when clearing the loop
					await requestTab(currentTabId, 'spectra.video.ab.clear', {});
					for (const marker of panel.querySelectorAll<HTMLElement>('.sp-btn-marker[data-action="mark-a"], .sp-btn-marker[data-action="mark-b"]')) {
						setPressed(marker, false);
					}
					break;
				}
			}
		};
	});
}

function setPressed(button: HTMLElement, pressed: boolean): void {
	button.classList.toggle('active', pressed);
	button.setAttribute('aria-pressed', String(pressed));
}

function bindFilterSliders(panel: HTMLElement): void {
	const sliders: Array<{
		cls: string;
		val: string;
		key: 'brightness' | 'contrast' | 'saturate';
	}> = [
		{ cls: '.sp-brightness', val: '.sp-brightness-val', key: 'brightness' },
		{ cls: '.sp-contrast', val: '.sp-contrast-val', key: 'contrast' },
		{ cls: '.sp-saturate', val: '.sp-saturate-val', key: 'saturate' },
	];

	sliders.forEach(({ cls, val, key }) => {
		const slider = panel.querySelector<HTMLInputElement>(cls);
		const valEl = panel.querySelector<HTMLElement>(val);
		if (!slider) return;

		slider.oninput = () => {
			if (valEl) valEl.textContent = `${slider.value}%`;
		};

		slider.onchange = async () => {
			if (!currentTabId) return;
			await requestTab(currentTabId, 'spectra.video.filter.set', { [key]: parseInt(slider.value, 10) });
		};
	});
}

function bindFilterSwitches(panel: HTMLElement): void {
	const grayscale = panel.querySelector<HTMLInputElement>('.sp-sw-grayscale');
	const invert = panel.querySelector<HTMLInputElement>('.sp-sw-invert');

	if (grayscale) {
		grayscale.onchange = async () => {
			if (!currentTabId) return;
			await requestTab(currentTabId, 'spectra.video.filter.set', { grayscale: grayscale.checked });
		};
	}

	if (invert) {
		invert.onchange = async () => {
			if (!currentTabId) return;
			await requestTab(currentTabId, 'spectra.video.filter.set', { invert: invert.checked });
		};
	}
}

// eff: attaches click handlers to seek buttons providing discrete jumps (e.g. +/- 5s, +/- 30s) based on dataset deltas
function bindSeekButtons(panel: HTMLElement): void {
	const seekBtns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn-small[data-action="seek"]');

	seekBtns.forEach(btn => {
		btn.onclick = async () => {
			if (!currentTabId) return;
			const delta = parseFloat(btn.dataset.delta ?? '0');
			await requestTab(currentTabId, 'spectra.video.seek', { delta });
		};
	});
}

