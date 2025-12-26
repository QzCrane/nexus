/**
 * SPECTRA Remote - Popup UI 绑定
 *
 * 职责：与 background 通信，显示遥控弹窗
 * 设计：每个标签页有独立的 session，通过 tabId 区分
 */

import { generateRemoteQR } from './qr-generator.js';
import { Actions } from '@nexus/contracts';
import { renderRemoteModal, closeRemoteModal, isRemoteModalOpen, setRemoteI18n } from './modal-renderer.js';
import type { I18NDict } from '../popup/types';

/** 遥控页面托管 URL */
const REMOTE_HOST = 'https://nexus-remote.pages.dev';

/** 语言字典 */
let currentDict: I18NDict | null = null;

/** 当前标签页 ID */
let currentTabId: number | null = null;

/** 连接状态检查定时器 */
let statusCheckInterval: number | null = null;

/** 是否已连接 */
let isConnected = false;

/**
 * 绑定遥控按钮事件 (需传入 tabId 和 i18n 字典)
 */
export function bindRemoteUI(tabId: number, dict?: I18NDict): void {
	currentTabId = tabId;

	// 设置 i18n
	if (dict) {
		currentDict = dict;
		setRemoteI18n(dict);
	}

	const btnRemote = document.getElementById('btn-remote');
	if (btnRemote) {
		btnRemote.addEventListener('click', toggleRemoteModal);
	}

	// 启动连接状态检查
	startStatusCheck();
}

/**
 * 更新遥控模块的 i18n
 */
export function updateRemoteI18n(dict: I18NDict): void {
	currentDict = dict;
	setRemoteI18n(dict);
	// 立即更新一次 UI 标题
	const btnRemote = document.getElementById('btn-remote');
	if (btnRemote) {
		if (isConnected) {
			btnRemote.title = dict.remoteConnectedTooltip;
		} else {
			btnRemote.title = dict.btnRemoteTooltip;
		}
	}
}

/**
 * 获取当前标签页是否有遥控器连接
 */
export function isRemoteConnected(): boolean {
	return isConnected;
}

/**
 * 启动连接状态定时检查
 */
function startStatusCheck(): void {
	if (statusCheckInterval) return;

	// 立即检查一次
	checkAndUpdateStatus();

	// 未连接时 3 秒检查，连接后也 3 秒健康检查
	statusCheckInterval = window.setInterval(checkAndUpdateStatus, 3000);
}

/**
 * 检查并更新连接状态 (针对当前标签页)
 */
async function checkAndUpdateStatus(): Promise<void> {
	const btnRemote = document.getElementById('btn-remote');
	if (!btnRemote || !currentTabId) return;

	try {
		// 传入 tabId 检查特定标签页的连接状态
		const res = await chrome.runtime.sendMessage({
			action: Actions.REMOTE_GET_SESSION,
			tabId: currentTabId,
		});

		if (res?.connected) {
			isConnected = true;
			btnRemote.classList.add('remote-connected');
			if (currentDict) btnRemote.title = currentDict.remoteConnectedTooltip;
		} else {
			isConnected = false;
			btnRemote.classList.remove('remote-connected');
			if (currentDict) btnRemote.title = currentDict.btnRemoteTooltip;
		}
	} catch {
		isConnected = false;
		btnRemote.classList.remove('remote-connected');
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

	if (!currentTabId) {
		console.error('[SPECTRA Remote] 未初始化 tabId');
		return;
	}

	// 显示加载状态
	const btnRemote = document.getElementById('btn-remote');
	if (btnRemote) {
		btnRemote.classList.add('loading');
		btnRemote.textContent = '⏳';
	}

	try {
		// 先检查当前标签页是否已有会话
		const existingSession = await chrome.runtime.sendMessage({
			action: Actions.REMOTE_GET_SESSION,
			tabId: currentTabId,
		});

		if (existingSession?.session) {
			const qrDataUrl = await generateRemoteQR(existingSession.session.sessionId, REMOTE_HOST);
			renderRemoteModal(qrDataUrl, existingSession.session.sessionId, existingSession.connected);
			return;
		}

		// 为当前标签页创建新会话
		const response = await chrome.runtime.sendMessage({
			action: Actions.REMOTE_CREATE_SESSION,
			tabId: currentTabId,
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
