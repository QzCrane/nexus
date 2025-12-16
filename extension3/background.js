let captureMap = new Map();

// --- 原始快捷键逻辑 ---
chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "shortcutTrigger", command: command }).catch(()=>{});
        }
    } catch (e) {}
});

// --- 新增捕获逻辑 ---
async function ensureOffscreen() {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['USER_MEDIA'],
            justification: 'Volume boosting'
        });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "getCaptureState") {
        sendResponse(captureMap.get(msg.tabId) || false);
        return true;
    }
    if (msg.action === "toggleCapture") {
        handleCaptureToggle(msg.tabId, msg.enabled, msg.config);
    }
    if (msg.action === "updateCaptureConfig") {
        if (captureMap.get(msg.tabId)) {
            chrome.runtime.sendMessage({ target: "offscreen", action: "updateConfig", tabId: msg.tabId, config: msg.config });
        }
    }
});

async function handleCaptureToggle(tabId, enabled, config) {
    try {
        await ensureOffscreen();
        if (enabled) {
            if (captureMap.get(tabId)) return;
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                if (!streamId) return;
                chrome.runtime.sendMessage({ target: "offscreen", action: "start", tabId: tabId, streamId: streamId, config: config });
                captureMap.set(tabId, true);
                chrome.tabs.sendMessage(tabId, { action: "captureStateChange", enabled: true }).catch(()=>{});
            });
        } else {
            if (!captureMap.get(tabId)) return;
            chrome.runtime.sendMessage({ target: "offscreen", action: "stop", tabId: tabId });
            captureMap.set(tabId, false);
            chrome.tabs.sendMessage(tabId, { action: "captureStateChange", enabled: false }).catch(()=>{});
        }
    } catch (e) { console.error(e); }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (captureMap.get(tabId)) handleCaptureToggle(tabId, false);
});