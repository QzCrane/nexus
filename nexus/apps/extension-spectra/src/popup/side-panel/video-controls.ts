/**
 * SPECTRA Popup - Side Panel Video Controls
 *
 * Bind events for buttons/sliders/switches in the Video section of side panel.
 */

import { sendToTab } from '../utils/dom';

let currentTabId: number | null = null;

export function setVideoControlTabId(tabId: number): void {
	currentTabId = tabId;
}

export function bindVideoControls(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	bindButtons(panel);
	bindFilterSliders(panel);
	bindFilterSwitches(panel);
	bindSeekButtons(panel);
}

function bindButtons(panel: HTMLElement): void {
	const btns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn[data-action]');

	btns.forEach(btn => {
		const action = btn.dataset.action;
		if (!action) return;

		btn.onclick = async () => {
			if (!currentTabId) return;

			switch (action) {
				case 'rotate': {
					const res = await sendToTab<{ rotation: number }>(currentTabId, 'VIDEO_ROTATE', {});
					if (res) btn.title = `Rotation: ${res.rotation}°`;
					break;
				}
				case 'mirror': {
					const res = await sendToTab<{ mirrored: boolean }>(currentTabId, 'VIDEO_MIRROR', {});
					if (res) btn.classList.toggle('active', res.mirrored);
					break;
				}
				case 'screenshot': {
					await sendToTab<{ dataUrl: string | null }>(currentTabId, 'VIDEO_SCREENSHOT', {});
					break;
				}
				case 'crop': {
					const res = await sendToTab<{ cropped: boolean }>(currentTabId, 'VIDEO_CROP', {});
					if (res) btn.classList.toggle('active', res.cropped);
					break;
				}
				case 'fullscreen': {
					const res = await sendToTab<{ active: boolean }>(currentTabId, 'VIDEO_FULLSCREEN', {});
					if (res) btn.classList.toggle('active', res.active);
					break;
				}
				case 'dim': {
					const res = await sendToTab<{ active: boolean; opacity: number }>(currentTabId, 'VIDEO_DIM_BACKGROUND', {});
					if (res) btn.classList.toggle('active', res.active);
					break;
				}
				case 'mark-a': {
					await sendToTab(currentTabId, 'VIDEO_AB_SET_A', {});
					btn.classList.add('active');
					break;
				}
				case 'mark-b': {
					await sendToTab(currentTabId, 'VIDEO_AB_SET_B', {});
					btn.classList.add('active');
					break;
				}
				case 'ab-loop': {
					await sendToTab(currentTabId, 'VIDEO_AB_CLEAR', {});
					panel.querySelector('.sp-btn-marker[data-action="mark-a"]')?.classList.remove('active');
					panel.querySelector('.sp-btn-marker[data-action="mark-b"]')?.classList.remove('active');
					break;
				}
			}
		};
	});
}

function bindFilterSliders(panel: HTMLElement): void {
	const sliders = [
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
			await sendToTab(currentTabId, 'VIDEO_SET_FILTER', { [key]: parseInt(slider.value, 10) });
		};
	});
}

function bindFilterSwitches(panel: HTMLElement): void {
	const grayscale = panel.querySelector<HTMLInputElement>('.sp-sw-grayscale');
	const invert = panel.querySelector<HTMLInputElement>('.sp-sw-invert');

	if (grayscale) {
		grayscale.onchange = async () => {
			if (!currentTabId) return;
			await sendToTab(currentTabId, 'VIDEO_SET_FILTER', { grayscale: grayscale.checked });
		};
	}

	if (invert) {
		invert.onchange = async () => {
			if (!currentTabId) return;
			await sendToTab(currentTabId, 'VIDEO_SET_FILTER', { invert: invert.checked });
		};
	}
}

function bindSeekButtons(panel: HTMLElement): void {
	const seekBtns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn-small[data-action="seek"]');

	seekBtns.forEach(btn => {
		btn.onclick = async () => {
			if (!currentTabId) return;
			const delta = parseFloat(btn.dataset.delta ?? '0');
			await sendToTab(currentTabId, 'VIDEO_SEEK', { delta });
		};
	});
}

