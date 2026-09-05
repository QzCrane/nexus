// goal: owns the tab and opening generation currently projected by the Popup side panel

let currentPanelTabId: number | null = null;
let panelSessionEpoch = 0;

export interface PanelSessionFence {
	readonly tabId: number | null;
	readonly epoch: number;
}

export function getCurrentPanelTabId(): number | null {
	return currentPanelTabId;
}

export function capturePanelSession(): PanelSessionFence {
	return { tabId: currentPanelTabId, epoch: panelSessionEpoch };
}

export function isCurrentPanelSession(fence: PanelSessionFence): boolean {
	return fence.tabId === currentPanelTabId && fence.epoch === panelSessionEpoch;
}

// eff: called only by the side-panel lifecycle owner when opening or closing a tab projection
export function setCurrentPanelTabId(tabId: number | null): PanelSessionFence {
	currentPanelTabId = tabId;
	panelSessionEpoch += 1;
	return capturePanelSession();
}
