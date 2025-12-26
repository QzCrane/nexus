/**
 * SPECTRA Remote - Background 远程服务
 * 
 * 职责：在 background 中运行 PeerJS，保持连接持久化
 */

import Peer, { DataConnection } from 'peerjs';
import { Actions } from '@nexus/contracts';
import { executeCommand, type RemoteCommand } from './remote-commands';

/** 会话状态 */
interface RemoteSession {
	sessionId: string;
	peerId: string;
	connected: boolean;
	tabId: number | null;
}

/** 当前状态 */
let peer: Peer | null = null;
let connection: DataConnection | null = null;
let session: RemoteSession | null = null;

const LOG = '[SPECTRA Remote]';

/** 生成会话 ID */
function generateSessionId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (let i = 0; i < 6; i++) {
		id += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return id;
}

/** 创建新会话 */
export async function createSession(tabId: number): Promise<RemoteSession> {
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
				if (session) session.connected = true;
				conn.send({ type: 'connected' });
			});

			conn.on('data', handleData);

			conn.on('close', () => {
				if (session) session.connected = false;
				connection = null;
			});
		});

		peer.on('error', reject);
		setTimeout(() => { if (!peer?.open) reject(new Error('Timeout')); }, 10000);
	});
}

/** 处理收到的数据 */
function handleData(data: unknown): void {
	if (!data || typeof data !== 'object') return;
	const msg = data as { type: string; command?: RemoteCommand };
	if (msg.type === 'command' && msg.command && session?.tabId) {
		console.log(LOG, 'Command:', msg.command);
		executeCommand(msg.command, session.tabId);
	}
}

/** 获取当前会话 */
export function getSession(): RemoteSession | null {
	return session;
}

/** 检查连接状态 */
export function isConnected(): boolean {
	return connection?.open === true;
}

/** 关闭会话 */
export async function closeSession(): Promise<void> {
	connection?.close();
	peer?.destroy();
	connection = null;
	peer = null;
	session = null;
}

/** 初始化消息监听 */
export function initRemoteService(): void {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.action === Actions.REMOTE_CREATE_SESSION) {
			const tabId = message.tabId || sender.tab?.id;
			if (tabId) {
				createSession(tabId)
					.then((s) => sendResponse({ success: true, session: s }))
					.catch((e) => sendResponse({ success: false, error: e.message }));
				return true;
			}
		}
		if (message.action === Actions.REMOTE_GET_SESSION) {
			sendResponse({ session: getSession(), connected: isConnected() });
		}
		if (message.action === Actions.REMOTE_CLOSE_SESSION) {
			closeSession().then(() => sendResponse({ success: true }));
			return true;
		}
		return false;
	});
	console.log(LOG, 'Service initialized');
}
