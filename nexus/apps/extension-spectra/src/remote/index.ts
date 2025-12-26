/**
 * SPECTRA Remote - 遥控模块
 * 
 * 职责：生成 QR 码，管理 WebRTC 会话，接收手机遥控指令
 */

export { generateRemoteQR } from './qr-generator.js';
export { getSession, createSession, closeSession } from './session.js';
export type { RemoteSession } from './session.js';
export { bindRemoteUI } from './ui-bindings.js';
export { initPeer, closePeer, isConnected } from './peer-connection.js';
export type { RemoteCommand } from './peer-connection.js';
