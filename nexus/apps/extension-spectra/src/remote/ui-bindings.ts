/**
 * SPECTRA Remote - Popup UI 绑定
 *
 * 职责：与 background 通信，显示遥控弹窗
 */

import { generateRemoteQR } from './qr-generator.js';
import { Actions } from '@nexus/contracts';
import { renderRemoteModal, closeRemoteModal, isRemoteModalOpen } from './modal-renderer.js';

/** 遥控页面托管 URL */
const REMOTE_HOST = 'https://nexus-remote.pages.dev';

/**
 * 绑定遥控按钮事件
 */
export function bindRemoteUI(): void {
	const btnRemote = document.getElementById('btn-remote');
	if (btnRemote) {
		btnRemote.addEventListener('click', toggleRemoteModal);
	}
}

/**
 * 切换遥控弹窗
 */
async function toggleRemoteModal(): Promise<void> {
	if (isRemoteModalOpen()) {
		closeRemoteModal();
		return;
	}

	// 显示加载状态
	const btnRemote = document.getElementById('btn-remote');
	if (btnRemote) {
		btnRemote.classList.add('loading');
		btnRemote.textContent = '⏳';
	}

	try {
		// 先检查是否已有会话
		const existingSession = await chrome.runtime.sendMessage({ action: Actions.REMOTE_GET_SESSION });

		if (existingSession?.session) {
			const qrDataUrl = await generateRemoteQR(existingSession.session.sessionId, REMOTE_HOST);
			renderRemoteModal(qrDataUrl, existingSession.session.sessionId, existingSession.connected);
			return;
		}

		// 获取当前标签页 ID
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const tabId = tab?.id;

		if (!tabId) {
			console.error('[SPECTRA Remote] 无法获取当前标签页');
			return;
		}

		// 通过消息让 background 创建会话
		const response = await chrome.runtime.sendMessage({
			action: Actions.REMOTE_CREATE_SESSION,
			tabId,
		});

		if (!response?.success) {
			console.error('[SPECTRA Remote] 创建会话失败:', response?.error);
			return;
		}

		const { session } = response;
		const qrDataUrl = await generateRemoteQR(session.sessionId, REMOTE_HOST);

		renderRemoteModal(qrDataUrl, session.sessionId, false);
	} catch (err) {
		console.error('[SPECTRA Remote] 初始化失败:', err);
	} finally {
		if (btnRemote) {
			btnRemote.classList.remove('loading');
			btnRemote.textContent = '📱';
		}
	}
}
