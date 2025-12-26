/**
 * SPECTRA Remote - Offscreen PeerJS 服务 (多会话版)
 * 
 * 职责：在 Offscreen Document 中运行多个 PeerJS 连接
 * 设计：每个标签页有独立的 session，通过 tabId 区分
 */

import Peer, { DataConnection } from 'peerjs';

/** 遥控命令类型 */
type RemoteCommand =
	| 'volume_up' | 'volume_down' | 'volume_max' | 'volume_100'
	| 'mute' | 'play_pause'
	| 'seek_forward' | 'seek_backward' | 'seek_forward_30' | 'seek_backward_30'
	| 'speed_up' | 'speed_down' | 'speed_reset'
	| 'fullscreen' | 'pip';

/** 会话状态 */
interface RemoteSession {
	sessionId: string;
	peerId: string;
	connected: boolean;
	tabId: number;
	peer: Peer;
	connection: DataConnection | null;
}

/** 多会话存储：tabId -> session */
const sessions = new Map<number, RemoteSession>();

const LOG = '[SPECTRA Remote Offscreen]';

/** 生成会话 ID */
function generateSessionId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (let i = 0; i < 6; i++) {
		id += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return id;
}

/** 创建会话 (不会顶掉其他 tabId 的会话) */
async function createSession(tabId: number): Promise<RemoteSession> {
	// 如果该 tabId 已有会话，直接返回
	const existing = sessions.get(tabId);
	if (existing) {
		return existing;
	}

	const sessionId = generateSessionId();
	const peerId = `spectra-${sessionId}`;

	return new Promise((resolve, reject) => {
		const peer = new Peer(peerId, { debug: 1 });

		const session: RemoteSession = {
			sessionId,
			peerId,
			connected: false,
			tabId,
			peer,
			connection: null,
		};

		peer.on('open', () => {
			console.log(LOG, `[Tab ${tabId}] Peer ready:`, peerId);
			sessions.set(tabId, session);
			resolve(session);
		});

		peer.on('connection', (conn) => {
			console.log(LOG, `[Tab ${tabId}] Connection from:`, conn.peer);
			session.connection = conn;

			conn.on('open', () => {
				console.log(LOG, `[Tab ${tabId}] DataChannel open`);
				session.connected = true;
				conn.send({ type: 'connected' });
				// 通知 background 状态变化 + 请求初始状态同步
				chrome.runtime.sendMessage({ type: 'REMOTE_STATUS_CHANGE', tabId, connected: true });
				chrome.runtime.sendMessage({ type: 'REMOTE_REQUEST_SYNC', tabId });
			});

			conn.on('data', (data) => handleData(data, tabId));

			conn.on('close', () => {
				console.log(LOG, `[Tab ${tabId}] Connection closed`);
				session.connected = false;
				session.connection = null;
				chrome.runtime.sendMessage({ type: 'REMOTE_STATUS_CHANGE', tabId, connected: false });
			});
		});

		peer.on('error', (err) => {
			console.error(LOG, `[Tab ${tabId}] Peer error:`, err);
			reject(err);
		});

		setTimeout(() => {
			if (!peer?.open) reject(new Error('Peer connection timeout'));
		}, 10000);
	});
}

/** 处理收到的数据 */
function handleData(data: unknown, tabId: number): void {
	if (!data || typeof data !== 'object') return;
	const msg = data as { type: string; command?: RemoteCommand };
	if (msg.type === 'command' && msg.command) {
		console.log(LOG, `[Tab ${tabId}] Command:`, msg.command);
		chrome.runtime.sendMessage({
			type: 'REMOTE_EXECUTE_COMMAND',
			command: msg.command,
			tabId,
		});
	}
}

/** 关闭指定标签页会话 */
async function closeSession(tabId: number): Promise<void> {
	const session = sessions.get(tabId);
	if (!session) return;

	session.connection?.close();
	session.peer?.destroy();
	sessions.delete(tabId);
	console.log(LOG, `[Tab ${tabId}] Session closed`);
}

/** 获取会话状态 (按 tabId) */
function getStatus(tabId?: number) {
	if (!tabId) {
		// 未指定 tabId，返回第一个会话 (兼容旧逻辑)
		const first = sessions.values().next().value;
		return first
			? { session: { sessionId: first.sessionId, tabId: first.tabId }, connected: first.connected }
			: { session: null, connected: false };
	}

	const session = sessions.get(tabId);
	if (!session) {
		return { session: null, connected: false };
	}
	return {
		session: { sessionId: session.sessionId, tabId: session.tabId },
		connected: session.connection?.open === true,
	};
}

/** 发送状态到指定标签页的手机 */
function sendStateToMobile(tabId: number, state: unknown): void {
	const session = sessions.get(tabId);
	if (session?.connection?.open) {
		session.connection.send({ type: 'state', ...state as object });
	}
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'REMOTE_OFFSCREEN_CREATE') {
		createSession(message.tabId)
			.then((s) => sendResponse({ success: true, session: { sessionId: s.sessionId, tabId: s.tabId } }))
			.catch((e) => sendResponse({ success: false, error: e.message }));
		return true;
	}

	if (message.type === 'REMOTE_OFFSCREEN_GET_STATUS') {
		sendResponse(getStatus(message.tabId));
		return false;
	}

	if (message.type === 'REMOTE_OFFSCREEN_CLOSE') {
		const tabId = message.tabId;
		if (tabId) {
			closeSession(tabId).then(() => sendResponse({ success: true }));
		} else {
			// 关闭所有会话
			Promise.all([...sessions.keys()].map(closeSession)).then(() => sendResponse({ success: true }));
		}
		return true;
	}

	// 接收状态更新并发送给指定标签页的手机
	if (message.type === 'REMOTE_OFFSCREEN_SEND_STATE') {
		if (message.tabId) {
			sendStateToMobile(message.tabId, message.state);
		}
		return false;
	}

	return false;
});

console.log(LOG, 'Offscreen ready (multi-session)');
