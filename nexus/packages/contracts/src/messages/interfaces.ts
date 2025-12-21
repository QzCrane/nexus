/**
 * NEXUS 消息协议 - 接口定义
 */

import type { NexusAction, NexusRequest, NexusResponse } from './definitions.js';

/** 消息发送端接口 (Popup/Content) */
export interface INexusMessenger {
	send<A extends NexusAction>(
		action: A,
		...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
	): Promise<NexusResponse<A>>;

	sendToTab<A extends NexusAction>(
		tabId: number,
		action: A,
		...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
	): Promise<NexusResponse<A>>;

	on<A extends NexusAction>(
		action: A,
		handler: (req: NexusRequest<A>) => void | NexusResponse<A>
	): () => void;
}

/** 消息路由器接口 (Background) */
export interface INexusRouter {
	on<A extends NexusAction>(
		action: A,
		handler: (
			req: NexusRequest<A>,
			sender: chrome.runtime.MessageSender
		) => NexusResponse<A> | Promise<NexusResponse<A>>
	): this;

	listen(): void;
	destroy(): void;
}
