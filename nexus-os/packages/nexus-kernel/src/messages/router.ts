/**
 * NEXUS Kernel - 消息路由器 (Message Router)
 * 
 * 用于 Background Service Worker 处理消息。
 * 
 * 使用方式:
 * ```typescript
 * import { createRouter } from '@nexus/kernel/messages';
 * 
 * const router = createRouter();
 * 
 * // 注册处理器 (IDE 自动补全 Action 名和参数类型)
 * router.on('AUDIO_GET_STATUS', async (req, sender) => {
 *   return { config: {...}, hasAudio: true, ... };
 * });
 * 
 * // 启动监听
 * router.listen();
 * ```
 */

import type { NexusAction, NexusRequest, NexusResponse } from '@nexus/contracts';

/** 消息处理器类型 */
type MessageHandler<A extends NexusAction> = (
  request: NexusRequest<A>,
  sender: chrome.runtime.MessageSender
) => Promise<NexusResponse<A>> | NexusResponse<A>;

/** 消息载荷格式 (内部使用) */
interface MessagePayload<A extends NexusAction = NexusAction> {
  action: A;
  payload: NexusRequest<A>;
  tabId?: number;
  source?: string;
  target?: 'offscreen';
}

/**
 * 创建类型安全的消息路由器
 * 
 * @returns 消息路由器实例
 */
export function createRouter() {
  // 处理器映射表
  const handlers = new Map<NexusAction, MessageHandler<NexusAction>>();
  
  // 是否已启动监听
  let isListening = false;
  
  return {
    /**
     * 注册消息处理器
     * 
     * @param action - 消息动作名称
     * @param handler - 处理函数
     */
    on<A extends NexusAction>(
      action: A,
      handler: MessageHandler<A>
    ): void {
      if (handlers.has(action)) {
        console.warn(`[NEXUS Router] Handler for ${action} already registered, overwriting.`);
      }
      // 使用 unknown 中间转换以满足 TypeScript 严格类型检查
      handlers.set(action, handler as unknown as MessageHandler<NexusAction>);
    },
    
    /**
     * 移除消息处理器
     * 
     * @param action - 消息动作名称
     */
    off<A extends NexusAction>(action: A): void {
      handlers.delete(action);
    },
    
    /**
     * 启动消息监听
     * 
     * 注意：此方法应在 Background Service Worker 的顶层调用，
     * 确保在扩展启动时立即注册监听器。
     */
    listen(): void {
      if (isListening) {
        console.warn('[NEXUS Router] Already listening, ignoring duplicate call.');
        return;
      }
      
      isListening = true;
      
      chrome.runtime.onMessage.addListener(
        (
          message: MessagePayload,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: unknown) => void
        ) => {
          // 忽略非 NEXUS 格式的消息
          if (!message || typeof message.action !== 'string') {
            return false;
          }
          
          // 忽略发往 Offscreen 的消息 (由 Offscreen 自己处理)
          if (message.target === 'offscreen') {
            return false;
          }
          
          const { action, payload } = message;
          const handler = handlers.get(action);
          
          if (!handler) {
            console.warn(`[NEXUS Router] No handler for action: ${action}`);
            return false;
          }
          
          // 执行处理器并发送响应
          Promise.resolve(handler(payload, sender))
            .then((response) => {
              sendResponse(response);
            })
            .catch((error) => {
              console.error(`[NEXUS Router] Handler error for ${action}:`, error);
              sendResponse({ error: error.message });
            });
          
          // 返回 true 表示异步响应
          return true;
        }
      );
      
      console.log('[NEXUS Router] Message listener started.');
    },
    
    /**
     * 广播消息到所有标签页
     * 
     * @param action - 消息动作名称
     * @param payload - 请求参数
     */
    async broadcast<A extends NexusAction>(
      action: A,
      ...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
    ): Promise<void> {
      const payload = args[0] as NexusRequest<A>;
      
      const tabs = await chrome.tabs.query({});
      
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action, payload }).catch(() => {
            // 静默处理：Content Script 可能未加载
          });
        }
      }
    }
  };
}

/** 消息路由器类型 */
export type NexusRouter = ReturnType<typeof createRouter>;
