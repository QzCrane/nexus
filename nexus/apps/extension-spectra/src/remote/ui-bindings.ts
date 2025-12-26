/**
 * SPECTRA Remote - Popup UI 绑定
 * 
 * 职责：与 background 通信，显示遥控弹窗
 */

import { generateRemoteQR } from './qr-generator.js';
import { Actions } from '@nexus/contracts';

/** 遥控弹窗状态 */
let isModalOpen = false;
let statusInterval: number | null = null;

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
	if (isModalOpen) {
		closeModal();
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
			// 已有会话，复用显示
			const qrDataUrl = await generateRemoteQR(existingSession.session.sessionId, REMOTE_HOST);
			showModal(qrDataUrl, existingSession.session.sessionId, existingSession.connected);
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

		// 生成 QR 码
		const qrDataUrl = await generateRemoteQR(session.sessionId, REMOTE_HOST);

		// 显示弹窗
		showModal(qrDataUrl, session.sessionId, false);
	} catch (err) {
		console.error('[SPECTRA Remote] 初始化失败:', err);
	} finally {
		// 恢复按钮状态
		if (btnRemote) {
			btnRemote.classList.remove('loading');
			btnRemote.textContent = '📱';
		}
	}
}

/**
 * 显示遥控弹窗
 * @param isConnected 初始连接状态
 */
function showModal(qrDataUrl: string, sessionId: string, isConnected = false): void {
	const existing = document.getElementById('remote-modal');
	if (existing) existing.remove();

	const statusClass = isConnected ? 'connected' : '';
	const statusText = isConnected ? '✅ 已连接' : '等待连接...';

	const modal = document.createElement('div');
	modal.id = 'remote-modal';
	modal.className = 'remote-modal';
	modal.innerHTML = `
		<div class="remote-modal-content">
			<div class="remote-modal-header">
				<span>📱 手机遥控</span>
				<button class="remote-modal-close">✕</button>
			</div>
			<div class="remote-modal-body">
				<img src="${qrDataUrl}" alt="QR Code" class="remote-qr" />
				<div class="remote-session-id">
					<span>会话码</span>
					<code>${sessionId}</code>
				</div>
				<div class="remote-status">
					<span class="remote-status-dot ${statusClass}"></span>
					<span class="remote-status-text">${statusText}</span>
				</div>
				<p class="remote-hint">📱 用手机扫描二维码，打开遥控页面连接<br>⚡ 关闭弹窗不会断开连接</p>
				<button class="remote-disconnect-btn">🔌 断开并关闭</button>
			</div>
		</div>
	`;

	document.body.appendChild(modal);
	isModalOpen = true;

	// 绑定关闭按钮 (不断开连接)
	modal.querySelector('.remote-modal-close')?.addEventListener('click', () => closeModal(false));
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal(false);
	});

	// 绑定断开按钮 (断开并关闭)
	modal.querySelector('.remote-disconnect-btn')?.addEventListener('click', () => closeModal(true));

	// 动态调整 popup 高度
	adjustPopupHeight(true);

	// 定时检查连接状态
	statusInterval = window.setInterval(async () => {
		const res = await chrome.runtime.sendMessage({ action: Actions.REMOTE_GET_SESSION });
		const dot = modal.querySelector('.remote-status-dot');
		const text = modal.querySelector('.remote-status-text');
		if (dot && text && res) {
			if (res.connected) {
				dot.classList.add('connected');
				text.textContent = '✅ 已连接';
			} else {
				dot.classList.remove('connected');
				text.textContent = '等待连接...';
			}
		}
	}, 1000);
}

/** 调整 popup 高度 */
function adjustPopupHeight(expand: boolean): void {
	const body = document.body;
	const MIN_HEIGHT = 520; // 遥控弹窗最小高度

	if (expand) {
		const currentHeight = body.offsetHeight;
		if (currentHeight < MIN_HEIGHT) {
			body.style.minHeight = `${MIN_HEIGHT}px`;
		}
	} else {
		body.style.minHeight = '';
	}
}

/**
 * 关闭弹窗
 * @param closeConnection 是否同时关闭连接
 */
function closeModal(closeConnection = false): void {
	const modal = document.getElementById('remote-modal');
	if (modal) {
		modal.remove();
		isModalOpen = false;

		if (statusInterval) {
			clearInterval(statusInterval);
			statusInterval = null;
		}

		// 恢复 popup 高度
		adjustPopupHeight(false);

		// 只在明确要求时关闭连接
		if (closeConnection) {
			chrome.runtime.sendMessage({ action: Actions.REMOTE_CLOSE_SESSION });
		}
	}
}

