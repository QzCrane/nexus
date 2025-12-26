/**
 * SPECTRA Remote - Background 服务 (管理 Offscreen)
 * 
 * 职责：创建/管理 offscreen document，转发消息
 */

import { Actions } from '@nexus/contracts';
import { executeCommand, type RemoteCommand } from './remote-commands';

const LOG = '[SPECTRA Remote BG]';
let offscreenCreated = false;

/** 确保 offscreen document 存在 */
async function ensureOffscreen(): Promise<void> {
	if (offscreenCreated) return;

	// 检查是否已存在 (使用 try-catch 兼容旧版 Chrome)
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
		// getContexts 不可用，尝试直接创建
	}

	// 创建 offscreen document
	await chrome.offscreen.createDocument({
		url: 'offscreen-remote.html',
		reasons: ['WEB_RTC'] as any,
		justification: 'PeerJS WebRTC for remote control',
	});

	offscreenCreated = true;
	console.log(LOG, 'Offscreen document created');
}

/** 关闭 offscreen document */
async function closeOffscreen(): Promise<void> {
	if (!offscreenCreated) return;

	try {
		await chrome.offscreen.closeDocument();
		offscreenCreated = false;
		console.log(LOG, 'Offscreen document closed');
	} catch (e) {
		// 可能已经关闭
	}
}

/** 初始化消息监听 */
export function initRemoteService(): void {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		// 创建会话
		if (message.action === Actions.REMOTE_CREATE_SESSION) {
			const tabId = message.tabId || sender.tab?.id;
			if (!tabId) {
				sendResponse({ success: false, error: 'No tabId' });
				return false;
			}

			ensureOffscreen()
				.then(() => chrome.runtime.sendMessage({
					type: 'REMOTE_OFFSCREEN_CREATE',
					tabId,
				}))
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

		return false;
	});

	console.log(LOG, 'Service initialized');
}
