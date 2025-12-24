/**
 * SPECTRA Popup - 侧边面板视频控制事件
 *
 * 职责：绑定侧边面板 Video 区块的按钮事件
 */

import { sendToTab } from '../utils/dom';

/** 获取当前活动 tabId */
let currentTabId: number | null = null;

/** 设置当前 tabId */
export function setVideoControlTabId(tabId: number): void {
	currentTabId = tabId;
}

/** 绑定视频控制按钮 */
export function bindVideoControls(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	const btns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn[data-action]');

	btns.forEach(btn => {
		const action = btn.dataset.action;

		btn.onclick = async () => {
			if (!currentTabId) return;

			switch (action) {
				case 'rotate': {
					const res = await sendToTab<{ rotation: number }>(currentTabId, 'VIDEO_ROTATE', {});
					if (res) {
						btn.title = `Rotation: ${res.rotation}°`;
					}
					break;
				}

				case 'mirror': {
					const res = await sendToTab<{ mirrored: boolean }>(currentTabId, 'VIDEO_MIRROR', {});
					if (res) {
						btn.classList.toggle('active', res.mirrored);
					}
					break;
				}

				case 'screenshot': {
					await sendToTab<{ dataUrl: string | null }>(currentTabId, 'VIDEO_SCREENSHOT', {});
					// 截图会自动下载，无需额外处理
					break;
				}

				case 'crop': {
					const res = await sendToTab<{ cropped: boolean }>(currentTabId, 'VIDEO_CROP', {});
					if (res) {
						btn.classList.toggle('active', res.cropped);
					}
					break;
				}
			}
		};
	});
}
