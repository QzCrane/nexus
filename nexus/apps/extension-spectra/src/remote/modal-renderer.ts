/**
 * SPECTRA Remote - Modal 渲染层
 * 
 * 职责：负责遥控弹窗的 DOM 创建、销毁与连接状态同步
 */

import { Actions } from '@nexus/contracts';

/** 遥控弹窗状态 */
let isModalOpen = false;
let statusInterval: number | null = null;

/**
 * 是否打开
 */
export const isRemoteModalOpen = () => isModalOpen;

/**
 * 显示遥控弹窗
 */
export function renderRemoteModal(qrDataUrl: string, sessionId: string, isConnected = false): void {
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
	modal.querySelector('.remote-modal-close')?.addEventListener('click', () => closeRemoteModal(false));

	// 完善：点击连接码自动复制
	const codeElem = modal.querySelector('.remote-session-id code');
	codeElem?.addEventListener('click', () => {
		navigator.clipboard.writeText(sessionId);
		const oldText = codeElem.textContent;
		codeElem.textContent = 'COPIED!';
		setTimeout(() => { if (codeElem) codeElem.textContent = oldText; }, 1000);
	});

	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeRemoteModal(false);
	});

	// 绑定断开按钮 (断开并关闭)
	modal.querySelector('.remote-disconnect-btn')?.addEventListener('click', () => closeRemoteModal(true));

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
	const MIN_HEIGHT = 520;

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
 */
export function closeRemoteModal(closeConnection = false): void {
	const modal = document.getElementById('remote-modal');
	if (modal) {
		modal.remove();
		isModalOpen = false;

		if (statusInterval) {
			clearInterval(statusInterval);
			statusInterval = null;
		}

		adjustPopupHeight(false);

		if (closeConnection) {
			chrome.runtime.sendMessage({ action: Actions.REMOTE_CLOSE_SESSION });
		}
	}
}
