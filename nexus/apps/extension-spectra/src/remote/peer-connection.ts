/**
 * SPECTRA Remote - PeerJS 连接管理
 * 
 * 职责：建立 WebRTC P2P 连接，接收遥控命令
 */

import Peer, { DataConnection } from 'peerjs';
import type { RemoteSession } from './session.js';

/** 遥控命令类型 */
export type RemoteCommand = 'volume_up' | 'volume_down' | 'mute' | 'play_pause' | 'seek_forward' | 'seek_backward';

/** 命令处理器 */
export type CommandHandler = (cmd: RemoteCommand) => void;

/** PeerJS 实例 */
let peer: Peer | null = null;
let connection: DataConnection | null = null;
let commandHandler: CommandHandler | null = null;

/**
 * 初始化 Peer 连接 (扩展端)
 */
export function initPeer(session: RemoteSession, onCommand: CommandHandler): Promise<string> {
	return new Promise((resolve, reject) => {
		commandHandler = onCommand;

		// 使用会话ID作为PeerId
		peer = new Peer(`spectra-${session.sessionId}`, {
			debug: 1,
		});

		peer.on('open', (id) => {
			console.log('[SPECTRA Remote] Peer 已就绪:', id);
			resolve(id);
		});

		peer.on('connection', (conn) => {
			console.log('[SPECTRA Remote] 收到连接:', conn.peer);
			connection = conn;

			conn.on('open', () => {
				console.log('[SPECTRA Remote] DataChannel 已打开');
				// 通知手机端已连接
				conn.send({ type: 'connected', peerId: peer?.id });
			});

			conn.on('data', (data) => {
				handleIncomingData(data);
			});

			conn.on('close', () => {
				console.log('[SPECTRA Remote] 连接已关闭');
				connection = null;
			});
		});

		peer.on('error', (err) => {
			console.error('[SPECTRA Remote] Peer 错误:', err);
			reject(err);
		});
	});
}

/**
 * 处理收到的数据
 */
function handleIncomingData(data: unknown): void {
	if (!data || typeof data !== 'object') return;

	const msg = data as { type: string; command?: RemoteCommand };

	if (msg.type === 'command' && msg.command && commandHandler) {
		console.log('[SPECTRA Remote] 收到命令:', msg.command);
		commandHandler(msg.command);
	}
}

/**
 * 发送状态更新到遥控器
 */
export function sendStateUpdate(state: { volume: number; muted: boolean; playing: boolean }): void {
	if (connection?.open) {
		connection.send({ type: 'state', ...state });
	}
}

/**
 * 检查是否已连接
 */
export function isConnected(): boolean {
	return connection?.open === true;
}

/**
 * 关闭 Peer 连接
 */
export function closePeer(): void {
	if (connection) {
		connection.close();
		connection = null;
	}
	if (peer) {
		peer.destroy();
		peer = null;
	}
	commandHandler = null;
}
