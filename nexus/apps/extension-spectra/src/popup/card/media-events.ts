/**
 * SPECTRA Popup - 卡片媒体控制事件
 *
 * 职责：绑定 Pause/Play、PiP、Speed 控件事件
 */

import type { CardUIElements } from '../types';
import { sendToTab } from '../utils/dom';

/** 绑定媒体控制事件 */
export function bindMediaControls(ui: CardUIElements, tabId: number): void {
	// Pause/Play
	if (ui.btnPause) {
		ui.btnPause.onclick = async () => {
			const res = await sendToTab<{ playing: boolean }>(tabId, 'MEDIA_TOGGLE_PLAY', {});
			if (res && ui.btnPause) {
				ui.btnPause.textContent = res.playing ? '⏸' : '▶';
			}
		};
	}

	// PiP
	if (ui.btnPip) {
		ui.btnPip.onclick = async () => {
			const res = await sendToTab<{ active: boolean }>(tabId, 'MEDIA_TOGGLE_PIP', {});
			if (res && ui.btnPip) {
				ui.btnPip.classList.toggle('active', res.active);
			}
		};
	}

	// Speed 按钮
	ui.speedBtns.forEach(btn => {
		btn.onclick = async () => {
			const delta = parseFloat(btn.dataset.delta || '0');
			// 先获取当前速率再计算新速率
			const stateRes = await sendToTab<{ speed: number }>(tabId, 'MEDIA_GET_STATE', {});
			const currentSpeed = stateRes?.speed ?? 1;
			const newSpeed = Math.max(0.1, Math.min(16, currentSpeed + delta));
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: newSpeed });
			if (res && ui.speedInput) {
				ui.speedInput.value = res.speed.toFixed(2);
			}
		};
	});

	// Speed 输入框
	if (ui.speedInput) {
		ui.speedInput.onchange = async (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value) || 1;
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed });
			if (res && ui.speedInput) {
				ui.speedInput.value = res.speed.toFixed(2);
			}
		};
	}
}
