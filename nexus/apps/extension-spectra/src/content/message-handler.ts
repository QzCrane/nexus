/**
 * SPECTRA Content Script - 消息处理器
 * 
 * 负责处理来自 Popup/Background 的消息
 */

import type { AudioConfig } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';

import { PolicyExecutor, PolicyExecutorState } from './policy-executor';
import { CaptureManager } from './capture-manager';
import { SettingsManager } from './settings-manager';
import { hasMediaElements, isAnyMediaPlaying, getPausedAt } from './dom-volume';
import { safeSend } from './context-guard';
import { handleMediaMessage } from './media-message-handler';

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
			case Actions.AUDIO_SET_CONFIG: {
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

			case Actions.AUDIO_GET_STATUS: {
				// 始终重新计算策略以触发 CORS 检测
				policyExecutor.applyState();

				// isAnyMediaPlaying 会自动更新 pausedAt
				const isPlaying = isAnyMediaPlaying();

				sendResponse({
					config: state.config,
					hasAudio: hasMediaElements(),
					isPlaying,
					mode: state.activeMode,
					userInteracted: state.userHasInteracted,
					pausedAt: getPausedAt(),
				});
				break;
			}

			case Actions.AUDIO_GET_VISUALIZER: {
				sendResponse({ buffer: getVisualizerData() });
				break;
			}

			case Actions.SHORTCUT_TRIGGER: {
				const payload = msg.payload as { command?: string; config?: AudioConfig } | undefined;
				if (payload?.config) {
					// 只有音量增减才强制解除静音，静音切换不应强制解除
					const shouldUnmute = payload.command !== 'toggle_mute';
					policyExecutor.updateConfig(payload.config, { showOSD: true, unMute: shouldUnmute });
				}
				sendResponse({ success: true });
				break;
			}

			case Actions.CAPTURE_STATE_CHANGE: {
				captureManager.handleMessage(msg as { action?: string; payload?: { enabled?: boolean }; enabled?: boolean });
				policyExecutor.applyState();
				policyExecutor.updateBadge();

				// 同时通知 Popup (如果是来自 Background 的自动更新)
				safeSend(() => new Promise<void>((resolve, reject) => {
					chrome.runtime.sendMessage({
						action: Actions.CAPTURE_STATE_CHANGE,
						payload: { enabled: captureManager.isActive() }
					}, {}, (response: any) => {
						if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
						else resolve(response);
					});
				})).catch(() => { });

				sendResponse({ success: true });
				break;
			}

			case Actions.GLOBAL_SETTINGS_UPDATE: {
				settingsManager.handleMessage(msg as { action?: string; settings?: { osdEnabled?: boolean; visualizerEnabled?: boolean; lang?: string } });
				// 关键：修改设置也视为用户交互（表达了增强意图）
				state.userHasInteracted = true;
				// 重新应用策略并同步角标颜色
				policyExecutor.applyState();
				policyExecutor.updateBadge();
				sendResponse({ success: true });
				break;
			}

			// ========== 媒体/视频控制 (委托到独立处理器) ==========
			default:
				if (handleMediaMessage(msg.action, msg.payload, sendResponse)) {
					return true;
				}
		}

		return true; // 异步响应
	};
}
