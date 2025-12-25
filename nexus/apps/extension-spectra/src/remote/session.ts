/**
 * SPECTRA Remote - 会话管理
 * 
 * 使用简化的 BroadcastChannel + 生成唯一 ID 方案
 * 后续可升级为 WebRTC DataChannel
 */

/** 会话状态 */
export interface RemoteSession {
	sessionId: string;
	peerId: string;
	connected: boolean;
	createdAt: number;
}

/** 当前会话 (单例) */
let currentSession: RemoteSession | null = null;

/** 生成随机 ID */
function generateId(length = 8): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * 获取当前会话
 */
export function getSession(): RemoteSession | null {
	return currentSession;
}

/**
 * 创建新会话
 */
export function createSession(): RemoteSession {
	// 关闭旧会话
	if (currentSession) {
		closeSession();
	}

	const sessionId = generateId(6);
	const peerId = `spectra-${sessionId}`;

	currentSession = {
		sessionId,
		peerId,
		connected: false,
		createdAt: Date.now(),
	};

	// 存储到 storage 供 Background 访问
	chrome.storage.session.set({ remoteSession: currentSession });

	return currentSession;
}

/**
 * 关闭会话
 */
export function closeSession(): boolean {
	if (!currentSession) return false;

	currentSession = null;
	chrome.storage.session.remove('remoteSession');

	return true;
}

/**
 * 标记会话已连接
 */
export function markConnected(): void {
	if (currentSession) {
		currentSession.connected = true;
		chrome.storage.session.set({ remoteSession: currentSession });
	}
}

/**
 * 从 storage 恢复会话
 */
export async function restoreSession(): Promise<RemoteSession | null> {
	const result = await chrome.storage.session.get('remoteSession');
	if (result.remoteSession) {
		currentSession = result.remoteSession as RemoteSession;
		return currentSession;
	}
	return null;
}
