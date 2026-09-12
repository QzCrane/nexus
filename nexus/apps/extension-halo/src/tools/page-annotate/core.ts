// goal: Page Annotate core logic

import { FRAME_TOOL_ANNOTATE_START, FRAME_TOOL_ANNOTATE_STOP, type FrameToolSession } from '../../content/frame-tool-messages';

export async function startAnnotation(): Promise<FrameToolSession> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) throw new Error('No active tab for annotation');
	const session = { tabId: tab.id, operationId: crypto.randomUUID() };
	await chrome.tabs.sendMessage(session.tabId, { type: FRAME_TOOL_ANNOTATE_START, operationId: session.operationId });
	return session;
}

export async function stopAnnotation(session: FrameToolSession): Promise<void> {
	await chrome.tabs.sendMessage(session.tabId, { type: FRAME_TOOL_ANNOTATE_STOP, operationId: session.operationId });
}
