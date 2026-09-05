// goal: central dispatcher for the remaining shared Nexus message protocol

import {
	NEXUS_ACTIONS,
	type NexusAction,
	type NexusRequest,
	type NexusResponse,
} from '@nexus/contracts';

type MessageHandler<A extends NexusAction> = (
	request: NexusRequest<A>,
	sender: chrome.runtime.MessageSender,
) => Promise<NexusResponse<A>> | NexusResponse<A>;

interface RoutingFields {
	tabId?: number;
	source?: 'popup' | 'content' | 'background' | 'offscreen' | 'sidepanel';
	target?: 'offscreen';
}

export type NexusMessageEnvelope<A extends NexusAction = NexusAction> = {
	[K in A]: RoutingFields & { action: K; payload: NexusRequest<K> };
}[A];

const NEXUS_ACTION_SET = new Set<string>(NEXUS_ACTIONS);
const SOURCES = new Set(['popup', 'content', 'background', 'offscreen', 'sidepanel']);
const VOID_ACTIONS = new Set<NexusAction>([
	'HALO_GET_STATUS',
	'HALO_RULER_START',
	'HALO_RULER_CANCEL',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown, maximumLength = 4096): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isEmptyPayload(value: unknown): boolean {
	return value === undefined || isRecord(value) && Object.keys(value).length === 0;
}

export function isNexusAction(value: unknown): value is NexusAction {
	return typeof value === 'string' && NEXUS_ACTION_SET.has(value);
}

export function isValidNexusRequestPayload<A extends NexusAction>(
	action: A,
	payload: unknown,
): payload is NexusRequest<A> {
	if (VOID_ACTIONS.has(action)) return isEmptyPayload(payload);
	if (!isRecord(payload)) return false;

	switch (action) {
		case 'HALO_TOOL_ACTIVATE':
		case 'HALO_TOOL_DEACTIVATE':
			return isNonEmptyString(payload.toolId, 128);
		case 'HALO_RULER_RESULT':
			return Object.hasOwn(payload, 'data');
		case 'HALO_SCROLL_TO_HEADING':
			return typeof payload.index === 'number'
				&& Number.isInteger(payload.index)
				&& payload.index >= 0;
		case 'HALO_CLIPBOARD_ADD':
			return typeof payload.text === 'string'
				&& (payload.sourceUrl === undefined || typeof payload.sourceUrl === 'string')
				&& (payload.sourceTitle === undefined || typeof payload.sourceTitle === 'string');
		default:
			return false;
	}
}

// post: returns a normalized discriminated envelope; empty void payloads become undefined
export function parseNexusMessage(value: unknown): NexusMessageEnvelope | null {
	if (!isRecord(value) || !isNexusAction(value.action)) return null;
	if (value.tabId !== undefined && !isPositiveInteger(value.tabId)) return null;
	if (value.source !== undefined
		&& (typeof value.source !== 'string' || !SOURCES.has(value.source))) return null;
	if (value.target !== undefined && value.target !== 'offscreen') return null;
	if (!isValidNexusRequestPayload(value.action, value.payload)) return null;

	const payload = VOID_ACTIONS.has(value.action) ? undefined : value.payload;
	return {
		action: value.action,
		payload,
		...(value.tabId === undefined ? {} : { tabId: value.tabId }),
		...(value.source === undefined ? {} : { source: value.source }),
		...(value.target === undefined ? {} : { target: value.target }),
	} as NexusMessageEnvelope;
}

export function createRouter() {
	const handlers = new Map<NexusAction, MessageHandler<NexusAction>>();
	let isListening = false;

	return {
		on<A extends NexusAction>(action: A, handler: MessageHandler<A>): void {
			if (handlers.has(action)) {
				console.warn(`[NEXUS Router] Handler for ${action} already registered, overwriting.`);
			}
			handlers.set(action, handler as unknown as MessageHandler<NexusAction>);
		},

		off<A extends NexusAction>(action: A): void {
			handlers.delete(action);
		},

		listen(): void {
			if (isListening) {
				console.warn('[NEXUS Router] Already listening, ignoring duplicate call.');
				return;
			}

			isListening = true;
			chrome.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
				const message = parseNexusMessage(rawMessage);
				if (!message || message.target === 'offscreen') return false;
				const handler = handlers.get(message.action);
				if (!handler) return false;

				Promise.resolve()
					.then(() => handler(message.payload, sender))
					.then(sendResponse)
					.catch((error: unknown) => {
						const messageText = error instanceof Error ? error.message : String(error);
						sendResponse({ error: messageText });
					});
				return true;
			});
		},

		async broadcast<A extends NexusAction>(
			action: A,
			...args: NexusRequest<A> extends void ? [] : [NexusRequest<A>]
		): Promise<void> {
			const payload = args[0] as NexusRequest<A>;
			const tabs = await chrome.tabs.query({});
			await Promise.allSettled(tabs.flatMap((tab) => (
				tab.id ? [chrome.tabs.sendMessage(tab.id, { action, payload })] : []
			)));
		},
	};
}

export type NexusRouter = ReturnType<typeof createRouter>;
