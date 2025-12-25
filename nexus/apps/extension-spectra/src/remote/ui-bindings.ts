/**
 * SPECTRA Remote - UI 绑定
 */

import { generateRemoteQR } from './qr-generator';
import { createSession, closeSession, getSession } from './session';

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

	// 创建会话
	const session = createSession();

	// 生成 QR 码
	const qrDataUrl = await generateRemoteQR(session.sessionId);

	// 显示弹窗
	showModal(qrDataUrl, session.sessionId);
}

/**
 * 显示遥控弹窗
 */
function showModal(qrDataUrl: string, sessionId: string): void {
	// 移除旧弹窗
	const existing = document.getElementById('remote-modal');
	if (existing) existing.remove();

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
				<p class="remote-hint">扫描二维码打开遥控页面</p>
			</div>
		</div>
	`;

	document.body.appendChild(modal);
	isModalOpen = true;

	// 绑定关闭按钮
	const closeBtn = modal.querySelector('.remote-modal-close');
	closeBtn?.addEventListener('click', closeModal);

	// 点击遮罩关闭
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});
}

/**
 * 关闭弹窗
 */
function closeModal(): void {
	const modal = document.getElementById('remote-modal');
	if (modal) {
		modal.remove();
		closeSession();
		isModalOpen = false;
	}
}
