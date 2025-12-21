/**
 * NEXUS 消息协议契约 (Message Protocol Contracts)
 * 
 * 定义所有消息类型的请求/响应格式。
 * 这是 RPC 总线的"合约"，发送消息时 IDE 会自动补全，参数类型错误直接报红。
 * 
 * @packageDocumentation
 */

import type { AudioConfig, AudioState, AudioMode } from './audio.contracts.js';
import type { GlobalSettings } from './settings.contracts.js';
import type { TabId } from './common.types.js';

// ============================================
// 消息协议注册表 (The Contract)
// ============================================

/**
 * NEXUS 消息协议注册表
 * 
 * 格式: `{ [ActionName]: { req: RequestType, res: ResponseType } }`
 * 
 * @example 发送消息
 * ```typescript
 * const messenger = createMessenger('popup');
 * const status = await messenger.send('AUDIO_GET_STATUS');
 * ```
 * 
 * @example 监听消息
 * ```typescript
 * router.on('AUDIO_GET_STATUS', async (req, sender) => {
 *   return { config: getConfig(), hasAudio: true, ... };
 * });
 * ```
 */
export interface NexusMessages {
  // ========== 音频控制 ==========

  /** 获取当前标签页的音频状态 */
  'AUDIO_GET_STATUS': {
    req: void;
    res: {
      config: AudioConfig;
      hasAudio: boolean;
      isPlaying: boolean;
      mode: AudioMode;
      userInteracted: boolean;
    };
  };

  /** 更新音频配置 */
  'AUDIO_SET_CONFIG': {
    req: { config: Partial<AudioConfig> };
    res: {
      success: boolean;
      state?: {
        config: AudioConfig;
        hasAudio: boolean;
        isPlaying: boolean;
        mode: AudioMode;
        userInteracted: boolean;
      };
    };
  };

  /** 获取可视化数据 (频谱) */
  'AUDIO_GET_VISUALIZER': {
    req: void;
    res: { buffer: number[] | null };
  };

  // ========== Capture 模式控制 ==========

  /** 切换 Tab Capture 模式 */
  'CAPTURE_TOGGLE': {
    req: { enabled: boolean; config?: AudioConfig; tabId?: number };
    res: { status: 'processing' | 'error'; error?: string };
  };

  /** 获取 Capture 状态 */
  'CAPTURE_GET_STATE': {
    req: { tabId?: number };
    res: boolean;
  };

  /** 更新 Offscreen 的音频配置 */
  'CAPTURE_UPDATE_CONFIG': {
    req: { tabId: number; config: AudioConfig };
    res: void;
  };

  /** Capture 状态变化通知 */
  'CAPTURE_STATE_CHANGE': {
    req: { tabId?: number; enabled: boolean };
    res: void;
  };

  // ========== 全局设置 ==========

  /** 更新全局设置 */
  'SETTINGS_UPDATE': {
    req: { settings: Partial<GlobalSettings> };
    res: { success: boolean };
  };

  /** 获取全局设置 */
  'SETTINGS_GET': {
    req: void;
    res: GlobalSettings;
  };

  // ========== 角标控制 ==========

  /** 更新插件图标角标 */
  'BADGE_UPDATE': {
    req: {
      tabId?: number;
      volume: number;
      muted: boolean;
      isCapture: boolean;
    };
    res: void;
  };

  /** 清除角标 */
  'BADGE_CLEAR': {
    req: { tabId?: number };
    res: void;
  };

  // ========== UI 同步 ==========

  /** 同步 UI 状态 (快捷键触发后通知 Popup) */
  'UI_SYNC': {
    req: {
      config: AudioConfig;
      mode?: AudioMode;
      isCaptureActive?: boolean;
    };
    res: void;
  };

  // ========== 快捷键 ==========

  /** 快捷键触发 */
  'SHORTCUT_TRIGGER': {
    req: {
      command: 'volume_up' | 'volume_down' | 'toggle_mute';
      config?: AudioConfig;
    };
    res: void;
  };

  // ========== 域名注册表 ==========

  /** 添加域名到强制劫持列表 */
  'REGISTRY_ADD_DOMAIN': {
    req: { domain: string };
    res: { success: boolean; reason?: string };
  };

  /** 从强制劫持列表移除域名 */
  'REGISTRY_REMOVE_DOMAIN': {
    req: { domain: string };
    res: { success: boolean };
  };

  // ========== Tab 状态管理 ==========

  /** Content Script 上报媒体元素状态 */
  'TAB_REPORT_MEDIA': {
    req: { hasMediaElement: boolean };
    res: void;
  };

  /** 获取应该在 Popup 中显示的标签页列表 */
  'TAB_GET_VISIBLE_TABS': {
    req: void;
    res: { tabs: number[] };
  };
}

// ============================================
// 类型工具
// ============================================

/** 所有消息的 Action 名称联合类型 */
export type NexusAction = keyof NexusMessages;

/** 根据 Action 获取 Request 类型 */
export type NexusRequest<A extends NexusAction> = NexusMessages[A]['req'];

/** 根据 Action 获取 Response 类型 */
export type NexusResponse<A extends NexusAction> = NexusMessages[A]['res'];

// ============================================
// 消息客户端/路由器接口
// ============================================

/**
 * 消息发送端接口 (Popup/Content 使用)
 */
export interface INexusMessenger {
  /** 发送消息并等待响应 */
  send<A extends NexusAction>(
    action: A,
    ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
  ): Promise<NexusResponse<A>>;

  /** 发送消息到指定标签页 */
  sendToTab<A extends NexusAction>(
    tabId: number,
    action: A,
    ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
  ): Promise<NexusResponse<A>>;

  /** 监听消息 */
  on<A extends NexusAction>(
    action: A,
    handler: (req: NexusRequest<A>) => void | NexusResponse<A>
  ): () => void;
}

/**
 * 消息路由器接口 (Background 使用)
 */
export interface INexusRouter {
  /** 注册消息处理器 */
  on<A extends NexusAction>(
    action: A,
    handler: (
      req: NexusRequest<A>,
      sender: chrome.runtime.MessageSender
    ) => NexusResponse<A> | Promise<NexusResponse<A>>
  ): this;

  /** 开始监听消息 */
  listen(): void;

  /** 停止监听 */
  destroy(): void;
}
