/**
 * SPECTRA Remote - 遥控模块 (Popup 端)
 * 
 * 职责：生成 QR 码，显示遥控 UI
 * 注意：PeerJS 连接在 background 中管理
 */

export { generateRemoteQR } from './qr-generator.js';
export { bindRemoteUI } from './ui-bindings.js';
