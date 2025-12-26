/**
 * SPECTRA Remote - UI 绑定
 */

import { generateRemoteQR } from './qr-generator.js';
import { createSession, closeSession, getSession } from './session.js';
import { initPeer, closePeer, isConnected, type RemoteCommand } from './peer-connection.js';
import { Actions } from '@nexus/contracts';

/** 遥控弹窗状态 */
let isModalOpen = false;

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
		// 创建会话
		const session = createSession();

		// 初始化 PeerJS
		await initPeer(session, handleRemoteCommand);

		// 生成 QR 码 (使用托管URL，手机可访问)
		const REMOTE_HOST = 'https://nexus-remote.pages.dev';
		const qrDataUrl = await generateRemoteQR(session.sessionId, REMOTE_HOST);

		// 显示弹窗
		showModal(qrDataUrl, session.sessionId);
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
 * 处理遥控命令
 */
function handleRemoteCommand(cmd: RemoteCommand): void {
	// 获取当前活动标签页并发送命令
	chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
		const tabId = tabs[0]?.id;
		if (!tabId) return;

		switch (cmd) {
			case 'volume_up':
				chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { volumeDelta: 10 } });
				break;
			case 'volume_down':
				chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { volumeDelta: -10 } });
				break;
			case 'mute':
				chrome.tabs.sendMessage(tabId, { action: Actions.AUDIO_SET_CONFIG, config: { toggleMute: true } });
				break;
			case 'play_pause':
				chrome.tabs.sendMessage(tabId, { action: Actions.MEDIA_TOGGLE_PLAY });
				break;
			case 'seek_forward':
				chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, delta: 10 });
				break;
			case 'seek_backward':
				chrome.tabs.sendMessage(tabId, { action: Actions.VIDEO_SEEK, delta: -10 });
				break;
		}
	});
}


/**
 * 显示遥控弹窗
 */
function showModal(qrDataUrl: string, sessionId: string): void {
	const existing = document.getElementById('remote-modal');
	if (existing) existing.remove();

	const connectedClass = isConnected() ? 'connected' : '';

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
					<span>会话码: </span>
					<code>${sessionId}</code>
				</div>
				<div class="remote-status ${connectedClass}">
					<span class="remote-status-dot"></span>
					<span class="remote-status-text">${isConnected() ? '已连接' : '等待连接...'}</span>
				</div>
			<p class="remote-hint">� 用手机扫描二维码，打开遥控页面连接</p>
			</div>
		</div>
	`;

	document.body.appendChild(modal);
	isModalOpen = true;

	// 绑定关闭
	modal.querySelector('.remote-modal-close')?.addEventListener('click', closeModal);
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});

	// 定时检查连接状态
	const statusInterval = setInterval(() => {
		const dot = modal.querySelector('.remote-status-dot');
		const text = modal.querySelector('.remote-status-text');
		if (dot && text) {
			if (isConnected()) {
				dot.classList.add('connected');
				text.textContent = '已连接';
			}
		}
		if (!isModalOpen) clearInterval(statusInterval);
	}, 1000);
}

/**
 * 关闭弹窗
 */
function closeModal(): void {
	const modal = document.getElementById('remote-modal');
	if (modal) {
		modal.remove();
		closePeer();
		closeSession();
		isModalOpen = false;
	}
}
