/**
 * NEXUS Kernel - 消息客户端 (Message Client)
 * 
 * 用于 Popup / Content Script / Side Panel 发送消息。
 * 
 * 使用方式:
 * ```typescript
 * import { createMessenger } from '@nexus/kernel/messages';
 * 
 * const messenger = createMessenger();
 * 
 * // 发送消息 (IDE 自动补全 Action 名和参数类型)
 * const status = await messenger.send('AUDIO_GET_STATUS');
 * console.log(status.config.volume);
 * 
 * // 发送到指定 Tab
 * await messenger.sendToTab(tabId, 'AUDIO_SET_CONFIG', { config: { volume: 200 } });
 * ```
 */

import type { NexusAction, NexusRequest, NexusResponse } from '@nexus/contracts';

/** 消息载荷格式 (内部使用) */
interface MessagePayload<A extends NexusAction = NexusAction> {
  /** 消息动作名称 */
  action: A;
  /** 请求参数 */
  payload: NexusRequest<A>;
  /** 目标标签页 ID (可选) */
  tabId?: number;
  /** 消息来源标识 */
  source?: 'popup' | 'content' | 'background' | 'offscreen' | 'sidepanel';
  /** 目标 (用于 Offscreen 路由) */
  target?: 'offscreen';
}

/**
 * 创建类型安全的消息客户端
 * 
 * @param source - 消息来源标识
 * @returns 消息客户端实例
 */
export function createMessenger(source: MessagePayload['source'] = 'popup') {
  return {
    /**
     * 发送消息到 Background Service Worker
     * 
     * @param action - 消息动作名称
     * @param payload - 请求参数 (如果 Request 是 void 则可省略)
     * @returns Promise<Response>
     */
    async send<A extends NexusAction>(
      action: A,
      ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
    ): Promise<NexusResponse<A>> {
      const payload = args[0] as NexusRequest<A>;
      
      const message: MessagePayload<A> = {
        action,
        payload,
        source
      };
      
      try {
        // MV3 Promise-based API 会直接 throw error，无需检查 lastError
        const response = await chrome.runtime.sendMessage(message);
        return response as NexusResponse<A>;
      } catch (error) {
        console.error(`[NEXUS] Failed to send message ${action}:`, error);
        throw error;
      }
    },
    
    /**
     * 发送消息到指定标签页的 Content Script
     * 
     * @param tabId - 目标标签页 ID
     * @param action - 消息动作名称
     * @param payload - 请求参数
     * @returns Promise<Response>
     */
    async sendToTab<A extends NexusAction>(
      tabId: number,
      action: A,
      ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
    ): Promise<NexusResponse<A>> {
      const payload = args[0] as NexusRequest<A>;
      
      const message: MessagePayload<A> = {
        action,
        payload,
        tabId,
        source
      };
      
      try {
        const response = await chrome.tabs.sendMessage(tabId, message);
        return response as NexusResponse<A>;
      } catch (error) {
        console.error(`[NEXUS] Failed to send message to tab ${tabId}:`, error);
        throw error;
      }
    },
    
    /**
     * 发送消息到 Offscreen Document
     * 
     * @param action - 消息动作名称
     * @param tabId - 关联的标签页 ID
     * @param payload - 请求参数
     */
    async sendToOffscreen<A extends NexusAction>(
      action: A,
      tabId: number,
      ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
    ): Promise<NexusResponse<A>> {
      const payload = args[0] as NexusRequest<A>;
      
      const message: MessagePayload<A> = {
        action,
        payload,
        tabId,
        target: 'offscreen',
        source
      };
      
      try {
        const response = await chrome.runtime.sendMessage(message);
        return response as NexusResponse<A>;
      } catch (error) {
        console.error(`[NEXUS] Failed to send message to offscreen:`, error);
        throw error;
      }
    }
  };
}

/** 消息客户端类型 */
export type NexusMessenger = ReturnType<typeof createMessenger>;
