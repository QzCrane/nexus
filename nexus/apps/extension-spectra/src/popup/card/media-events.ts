/**
 * SPECTRA Popup - 卡片媒体控制事件
 *
 * 职责：绑定 Pause/Play、PiP、Speed、Hotkey Target 控件事件
 */

import type { CardUIElements } from '../types';
import { sendToTab } from '../utils/dom';

/** 暂停图标 SVG */
const PAUSE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
/** 播放图标 SVG */
const PLAY_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

/** 绑定媒体控制事件 */
export function bindMediaControls(ui: CardUIElements, tabId: number): void {
	// Pause/Play
	if (ui.btnPause) {
		ui.btnPause.onclick = async () => {
			const res = await sendToTab<{ playing: boolean }>(tabId, 'MEDIA_TOGGLE_PLAY', {});
			if (res && ui.btnPause) {
				ui.btnPause.innerHTML = res.playing ? PAUSE_SVG : PLAY_SVG;
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
			const stateRes = await sendToTab<{ speed: number }>(tabId, 'MEDIA_GET_STATE', {});
			const currentSpeed = stateRes?.speed ?? 1;
			const newSpeed = Math.max(0.1, Math.min(16, currentSpeed + delta));
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: newSpeed });
			if (res && ui.speedInput) {
				ui.speedInput.value = res.speed.toFixed(2);
			}
		};
	});

	// Speed 输入框 - change + wheel
	if (ui.speedInput) {
		const updateSpeed = async (speed: number) => {
			const clampedSpeed = Math.max(0.1, Math.min(16, speed));
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: clampedSpeed });
			if (res && ui.speedInput) {
				ui.speedInput.value = res.speed.toFixed(2);
			}
		};

		ui.speedInput.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value) || 1;
			updateSpeed(speed);
		};

		// 滚轮支持
		ui.speedInput.onwheel = (e) => {
			e.preventDefault();
			const current = parseFloat(ui.speedInput!.value) || 1;
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			updateSpeed(current + delta);
		};
	}

	// 快捷键目标按钮 - 切换当前标签页为快捷键目标
	if (ui.btnHotkeyTarget) {
		ui.btnHotkeyTarget.onclick = () => {
			// 存储当前 tabId 作为快捷键目标
			chrome.storage.local.set({ hotkeyTargetTabId: tabId }, () => {
				ui.btnHotkeyTarget?.classList.add('active');
				// 2秒后移除激活状态
				setTimeout(() => ui.btnHotkeyTarget?.classList.remove('active'), 2000);
			});
		};
	}

	// 返回标签页按钮 - 激活该标签页
	if (ui.btnGotoTab) {
		ui.btnGotoTab.onclick = () => {
			chrome.tabs.update(tabId, { active: true });
		};
	}
}

