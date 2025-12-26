/**
 * SPECTRA Remote - Offscreen PeerJS 服务
 * 
 * 职责：在 Offscreen Document 中运行 PeerJS (支持 WebRTC)
 */

import Peer, { DataConnection } from 'peerjs';

/** 遥控命令类型 */
type RemoteCommand = 'volume_up' | 'volume_down' | 'mute' | 'play_pause' | 'seek_forward' | 'seek_backward';

/** 会话状态 */
interface RemoteSession {
	sessionId: string;
	peerId: string;
	connected: boolean;
	tabId: number;
}

let peer: Peer | null = null;
let connection: DataConnection | null = null;
let session: RemoteSession | null = null;

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

/** 创建会话 */
async function createSession(tabId: number): Promise<RemoteSession> {
	// 关闭旧连接
	await closeSession();

	const sessionId = generateSessionId();
	session = { sessionId, peerId: `spectra-${sessionId}`, connected: false, tabId };

	return new Promise((resolve, reject) => {
		peer = new Peer(session!.peerId, { debug: 1 });

		peer.on('open', () => {
			console.log(LOG, 'Peer ready:', session!.peerId);
			resolve(session!);
		});

		peer.on('connection', (conn) => {
			console.log(LOG, 'Connection from:', conn.peer);
			connection = conn;

			conn.on('open', () => {
				console.log(LOG, 'DataChannel open');
				if (session) session.connected = true;
				conn.send({ type: 'connected' });
				// 通知 background 状态变化
				chrome.runtime.sendMessage({ type: 'REMOTE_STATUS_CHANGE', connected: true });
			});

			conn.on('data', (data) => handleData(data));

			conn.on('close', () => {
				console.log(LOG, 'Connection closed');
				if (session) session.connected = false;
				connection = null;
				chrome.runtime.sendMessage({ type: 'REMOTE_STATUS_CHANGE', connected: false });
			});
		});

		peer.on('error', (err) => {
			console.error(LOG, 'Peer error:', err);
			reject(err);
		});

		setTimeout(() => {
			if (!peer?.open) reject(new Error('Peer connection timeout'));
		}, 10000);
	});
}

/** 处理收到的数据 */
function handleData(data: unknown): void {
	if (!data || typeof data !== 'object') return;
	const msg = data as { type: string; command?: RemoteCommand };
	if (msg.type === 'command' && msg.command && session?.tabId) {
		console.log(LOG, 'Command:', msg.command);
		// 发送到 background，由 background 转发到 content script
		chrome.runtime.sendMessage({
			type: 'REMOTE_EXECUTE_COMMAND',
			command: msg.command,
			tabId: session.tabId,
		});
	}
}

/** 关闭会话 */
async function closeSession(): Promise<void> {
	connection?.close();
	peer?.destroy();
	connection = null;
	peer = null;
	session = null;
}

/** 获取状态 */
function getStatus() {
	return {
		session,
		connected: connection?.open === true,
	};
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'REMOTE_OFFSCREEN_CREATE') {
		createSession(message.tabId)
			.then((s) => sendResponse({ success: true, session: s }))
			.catch((e) => sendResponse({ success: false, error: e.message }));
		return true;
	}

	if (message.type === 'REMOTE_OFFSCREEN_GET_STATUS') {
		sendResponse(getStatus());
		return false;
	}

	if (message.type === 'REMOTE_OFFSCREEN_CLOSE') {
		closeSession().then(() => sendResponse({ success: true }));
		return true;
	}

	return false;
});

console.log(LOG, 'Offscreen ready');
