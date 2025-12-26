/**
 * SPECTRA Remote - Background 服务 (管理 Offscreen)
 * 
 * 职责：创建/管理 offscreen document，转发消息，状态同步
 */

import { Actions } from '@nexus/contracts';
import { executeCommand, setStateCallback, type RemoteCommand, type RemoteState } from './remote-commands';

const LOG = '[SPECTRA Remote BG]';
let offscreenCreated = false;

/** 确保 offscreen document 存在 */
async function ensureOffscreen(): Promise<void> {
	if (offscreenCreated) return;

	try {
		const contexts = await (chrome.runtime as any).getContexts({
			contextTypes: ['OFFSCREEN_DOCUMENT'],
			documentUrls: [chrome.runtime.getURL('offscreen-remote.html')],
		});

		if (contexts && contexts.length > 0) {
			offscreenCreated = true;
			return;
		}
	} catch {
		// getContexts 不可用
	}

	await chrome.offscreen.createDocument({
		url: 'offscreen-remote.html',
		reasons: ['WEB_RTC'] as any,
		justification: 'PeerJS WebRTC for remote control',
	});

	offscreenCreated = true;
	console.log(LOG, 'Offscreen created');
}

/** 关闭 offscreen document */
async function closeOffscreen(): Promise<void> {
	if (!offscreenCreated) return;
	try {
		await chrome.offscreen.closeDocument();
		offscreenCreated = false;
	} catch { /* 可能已关闭 */ }
}

/** 发送状态到 offscreen (转发给手机) */
function sendStateToOffscreen(state: RemoteState): void {
	if (offscreenCreated) {
		chrome.runtime.sendMessage({ type: 'REMOTE_OFFSCREEN_SEND_STATE', state });
	}
}

/** 初始化消息监听 */
export function initRemoteService(): void {
	// 设置状态回调
	setStateCallback(sendStateToOffscreen);

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		// 创建会话
		if (message.action === Actions.REMOTE_CREATE_SESSION) {
			const tabId = message.tabId || sender.tab?.id;
			if (!tabId) {
				sendResponse({ success: false, error: 'No tabId' });
				return false;
			}

			ensureOffscreen()
				.then(() => chrome.runtime.sendMessage({ type: 'REMOTE_OFFSCREEN_CREATE', tabId }))
				.then((res) => sendResponse(res))
				.catch((e) => sendResponse({ success: false, error: e.message }));
			return true;
		}

		// 获取状态
		if (message.action === Actions.REMOTE_GET_SESSION) {
			if (!offscreenCreated) {
				sendResponse({ session: null, connected: false });
				return false;
			}
			chrome.runtime.sendMessage({ type: 'REMOTE_OFFSCREEN_GET_STATUS' })
				.then((res) => sendResponse(res))
				.catch(() => sendResponse({ session: null, connected: false }));
			return true;
		}

		// 关闭会话
		if (message.action === Actions.REMOTE_CLOSE_SESSION) {
			if (!offscreenCreated) {
				sendResponse({ success: true });
				return false;
			}
			chrome.runtime.sendMessage({ type: 'REMOTE_OFFSCREEN_CLOSE' })
				.then(() => closeOffscreen())
				.then(() => sendResponse({ success: true }))
				.catch(() => sendResponse({ success: true }));
			return true;
		}

		// 来自 offscreen 的命令执行请求
		if (message.type === 'REMOTE_EXECUTE_COMMAND') {
			const { command, tabId } = message as { command: RemoteCommand; tabId: number };
			executeCommand(command, tabId);
			return false;
		}

		// 来自 offscreen 的初始状态同步请求
		if (message.type === 'REMOTE_REQUEST_SYNC') {
			const { tabId } = message as { tabId?: number };
			if (tabId) {
				import('./remote-commands').then(m => m.syncState(tabId));
			}
			return false;
		}

		return false;
	});

	console.log(LOG, 'Service initialized');
}
