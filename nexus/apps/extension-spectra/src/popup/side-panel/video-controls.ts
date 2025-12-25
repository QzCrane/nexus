/**
 * SPECTRA Popup - 侧边面板视频控制事件
 *
 * 职责：绑定侧边面板 Video 区块的按钮/滑块/开关事件
 */

import { sendToTab } from '../utils/dom';

/** 当前活动 tabId */
let currentTabId: number | null = null;

/** 设置当前 tabId */
export function setVideoControlTabId(tabId: number): void {
	currentTabId = tabId;
}

/** 绑定视频控制按钮 */
export function bindVideoControls(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	// 绑定按钮事件
	bindButtons(panel);
	// 绑定滤镜滑块
	bindFilterSliders(panel);
	// 绑定滤镜开关
	bindFilterSwitches(panel);
	// 绑定时间跳转
	bindSeekButtons(panel);
}

/** 绑定视频变换按钮 */
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

/** 绑定滤镜滑块 (亮度/对比度/饱和度) */
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

/** 绑定滤镜开关 (灰度/反色) */
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

/** 绑定时间跳转按钮 */
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

