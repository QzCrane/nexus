/**
 * SPECTRA Content Script - 消息处理器
 * 
 * 负责处理来自 Popup/Background 的消息
 */

import type { AudioConfig } from '@nexus/kernel';

import { PolicyExecutor, PolicyExecutorState } from './policy-executor';
import { CaptureManager } from './capture-manager';
import { SettingsManager } from './settings-manager';
import { hasMediaElements, isAnyMediaPlaying } from './dom-volume';
import { safeSend } from './context-guard';

/** 消息处理器依赖 */
export interface MessageHandlerDeps {
	state: PolicyExecutorState;
	policyExecutor: PolicyExecutor;
	captureManager: CaptureManager;
	settingsManager: SettingsManager;
	getVisualizerData: () => number[] | null;
}

/**
 * 创建消息处理器
 */
export function createMessageHandler(deps: MessageHandlerDeps): (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void
) => boolean | undefined {
	const { state, policyExecutor, captureManager, settingsManager, getVisualizerData } = deps;

	return (message, _sender, sendResponse) => {
		const msg = message as { action?: string; payload?: unknown; config?: AudioConfig; command?: string; settings?: unknown };
		if (!msg?.action) return false;

		switch (msg.action) {
			// ========== NEXUS 格式 ==========
			case 'AUDIO_SET_CONFIG': {
				const payload = msg.payload as { config: Partial<AudioConfig> };
				policyExecutor.updateConfig(payload.config);
				sendResponse({
					success: true,
					state: {
						config: state.config,
						hasAudio: hasMediaElements(),
						isPlaying: isAnyMediaPlaying(),
						mode: state.activeMode,
						userInteracted: state.userHasInteracted,
					}
				});
				break;
			}

			// ========== 状态查询 ==========
			case 'AUDIO_GET_STATUS': {
				if (state.activeMode === null) {
					policyExecutor.applyState();
				}
				sendResponse({
					config: state.config,
					hasAudio: hasMediaElements(),
					isPlaying: isAnyMediaPlaying(),
					mode: state.activeMode,
					userInteracted: state.userHasInteracted,
				});
				break;
			}

			// ========== 频谱数据 ==========
			case 'AUDIO_GET_VISUALIZER': {
				sendResponse({ buffer: getVisualizerData() });
				break;
			}

			// ========== 快捷键触发 ==========
			case 'SHORTCUT_TRIGGER': {
				const payload = msg.payload as { command?: string; config?: AudioConfig } | undefined;
				if (payload?.config) {
					// 只有音量增减才强制解除静音，静音切换不应强制解除
					const shouldUnmute = payload.command !== 'toggle_mute';
					policyExecutor.updateConfig(payload.config, { showOSD: true, unMute: shouldUnmute });
				}
				sendResponse({ success: true });
				break;
			}

			// ========== Capture 状态变更 ==========
			case 'CAPTURE_STATE_CHANGE': {
				captureManager.handleMessage(msg as { action?: string; payload?: { enabled?: boolean }; enabled?: boolean });
				policyExecutor.applyState();
				policyExecutor.updateBadge();

				// 同时通知 Popup (如果是来自 Background 的自动更新)
				safeSend(() => new Promise<void>((resolve, reject) => {
					chrome.runtime.sendMessage({
						action: 'CAPTURE_STATE_CHANGE',
						payload: { enabled: captureManager.isActive() }
					}, {}, (response: any) => {
						if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
						else resolve(response);
					});
				})).catch(() => { });

				sendResponse({ success: true });
				break;
			}

			// ========== 全局设置更新 ==========
			case 'GLOBAL_SETTINGS_UPDATE': {
				settingsManager.handleMessage(msg as { action?: string; settings?: { osdEnabled?: boolean; visualizerEnabled?: boolean; lang?: string } });
				// 关键：修改设置也视为用户交互（表达了增强意图）
				state.userHasInteracted = true;
				policyExecutor.applyState();
				sendResponse({ success: true });
				break;
			}
		}

		return true; // 异步响应
	};
}
