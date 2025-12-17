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

// --- Capture 逻辑 ---
async function ensureOffscreen() {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['USER_MEDIA'],
            justification: 'Audio processing and visualizer'
        });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 获取状态
    if (msg.action === "getCaptureState") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        sendResponse(targetTabId ? (captureMap.get(targetTabId) || false) : false);
        return true;
    }

    // 切换 Capture 状态
    if (msg.action === "toggleCapture") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId) {
            handleCaptureToggle(targetTabId, msg.enabled, msg.config);
        }
    }

    // 更新配置到 Offscreen
    if (msg.action === "updateCaptureConfig") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId && captureMap.get(targetTabId)) {
            chrome.runtime.sendMessage({ 
                target: "offscreen", 
                action: "updateConfig", 
                tabId: targetTabId, 
                config: msg.config 
            });
        }
    }
});

async function handleCaptureToggle(tabId, enabled, config) {
    try {
        await ensureOffscreen();
        if (enabled) {
            if (captureMap.get(tabId)) {
                if (config) {
                     chrome.runtime.sendMessage({ 
                        target: "offscreen", 
                        action: "updateConfig", 
                        tabId: tabId, 
                        config: config 
                    });
                }
                return;
            }
            
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                if (chrome.runtime.lastError) {
                    console.warn("Capture failed:", chrome.runtime.lastError.message);
                    // 检测是否需要用户交互 (Chrome 策略)
                    if (chrome.runtime.lastError.message.includes("invoked")) {
                        chrome.tabs.sendMessage(tabId, { action: "CAPTURE_NEEDS_GESTURE" }).catch(()=>{});
                    } else {
                        chrome.tabs.sendMessage(tabId, { action: "showToast", text: "Capture failed: " + chrome.runtime.lastError.message }).catch(()=>{});
                    }
                    return;
                }
                if (!streamId) return;
                
                chrome.runtime.sendMessage({ 
                    target: "offscreen", 
                    action: "start", 
                    tabId: tabId, 
                    streamId: streamId, 
                    config: config 
                });
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && captureMap.get(tabId)) {
        console.log(`[VM] Tab ${tabId} scanning/reloading, clearing capture state.`);
        handleCaptureToggle(tabId, false);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (captureMap.get(tabId)) handleCaptureToggle(tabId, false);
});