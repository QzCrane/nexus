// goal: DOM Selector core logic (Message Proxy)

import { FRAME_TOOL_DOM_SELECTOR_START, FRAME_TOOL_DOM_SELECTOR_STOP, type FrameToolSession } from '../../content/frame-tool-messages';

export async function startSelection(): Promise<FrameToolSession> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) throw new Error('No active tab for DOM selection');
	const session = { tabId: tab.id, operationId: crypto.randomUUID() };
	await chrome.tabs.sendMessage(session.tabId, { type: FRAME_TOOL_DOM_SELECTOR_START, operationId: session.operationId });
	return session;
}

export async function stopSelection(session: FrameToolSession): Promise<void> {
	await chrome.tabs.sendMessage(session.tabId, { type: FRAME_TOOL_DOM_SELECTOR_STOP, operationId: session.operationId });
}
