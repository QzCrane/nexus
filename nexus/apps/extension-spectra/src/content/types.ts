/**
 * SPECTRA Content Script - 类型定义
 */

import type { AudioConfig, NexusMessenger } from '@nexus/kernel';
import { PolicyEngine, WebAudioController } from '@nexus/audio-engine';
import type { CaptureManager } from './capture-manager';
import type { SettingsManager } from './settings-manager';

/** 策略执行器状态 */
export interface PolicyExecutorState {
	config: AudioConfig;
	activeMode: string | null;
	userHasInteracted: boolean;
	isPopupOpen: boolean;
}

/** 策略执行器依赖 */
export interface PolicyExecutorDeps {
	messenger: NexusMessenger;
	policyEngine: PolicyEngine;
	audioController: WebAudioController;
	captureManager: CaptureManager;
	settingsManager: SettingsManager;
}
