let captureMap = new Map();
let captureLocks = new Map(); // Mutex locks to prevent race conditions on same tab

// Ensure offscreen document exists
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

// Mutex helper
async function acquireLock(tabId) {
    while (captureLocks.get(tabId)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    captureLocks.set(tabId, true);
}

function releaseLock(tabId) {
    captureLocks.delete(tabId);
}

// Main logic
async function handleCaptureToggle(tabId, enabled, config) {
    await acquireLock(tabId);
    try {
        const platform = await chrome.runtime.getPlatformInfo();
        
        if (enabled) {
            // Check if already active
            if (captureMap.get(tabId)) {
                // Just update config
                if (config) {
                    chrome.runtime.sendMessage({ 
                        target: "offscreen", 
                        action: "updateConfig", 
                        tabId: tabId, 
                        config: config 
                    }).catch(()=>{});
                }
                return;
            }

            await ensureOffscreen();
            
            // Promisify getMediaStreamId
            const streamId = await new Promise((resolve, reject) => {
                chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (sid) => {
                    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                    resolve(sid);
                });
            });

            if (!streamId) throw new Error("No Stream ID returned");

            // Start in Offscreen
            chrome.runtime.sendMessage({ 
                target: "offscreen", 
                action: "start", 
                tabId: tabId, 
                streamId: streamId, 
                config: config 
            });

            captureMap.set(tabId, true);
            // Notify content script AND Popup
            chrome.tabs.sendMessage(tabId, { action: "captureStateChange", enabled: true }).catch(()=>{});
            chrome.runtime.sendMessage({ action: "captureStateChange", tabId: tabId, enabled: true }).catch(()=>{});

        } else {
            // Stop logic
            if (!captureMap.get(tabId)) return;

            chrome.runtime.sendMessage({ target: "offscreen", action: "stop", tabId: tabId });
            captureMap.set(tabId, false);
            
            // Notify content script AND Popup
            chrome.tabs.sendMessage(tabId, { action: "captureStateChange", enabled: false }).catch(()=>{});
            chrome.runtime.sendMessage({ action: "captureStateChange", tabId: tabId, enabled: false }).catch(()=>{});
        }
    } catch (e) {
        console.warn(`[VM] Capture Toggle Failed (Tab ${tabId}):`, e);
        // If "Cannot capture", it often means previous stream cleanup lagged.
        // We should notify the tab so it doesn't get stuck in "Waiting" state.
        chrome.tabs.sendMessage(tabId, { action: "captureStateChange", enabled: false }).catch(()=>{});
        
        if (e.message && e.message.includes("invoked")) {
             // User gesture required (rare with getMediaStreamId but possible)
             chrome.tabs.sendMessage(tabId, { action: "showToast", text: "Click page to activate enhancer" }).catch(()=>{});
        }
    } finally {
        releaseLock(tabId);
    }
}

// Message Router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "getCaptureState") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        sendResponse(targetTabId ? (captureMap.get(targetTabId) || false) : false);
        return true;
    }

    if (msg.action === "toggleCapture") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId) {
            handleCaptureToggle(targetTabId, msg.enabled, msg.config);
            // We don't wait for the async operation to keep message channel responsive
            sendResponse({ status: "processing" }); 
        }
    }

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
    
    // UI Sync Broadcast (Popup <-> Content)
    if (msg.action === "syncUI") {
         // Forward to popup if open? Or broadcast to other content scripts?
         // Usually just broadcast to the specific tab's popup logic, but popup polls mostly.
         // We can broadcast to runtime to reach Popup.
         chrome.runtime.sendMessage({ ...msg, fromBackground: true }).catch(()=>{});
    }
});

// Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "shortcutTrigger", command: command }).catch(()=>{});
        }
    } catch (e) {}
});

// Clean up on tab close/nav
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && captureMap.get(tabId)) {
        console.log(`[VM] Tab ${tabId} reloading, force stopping capture.`);
        handleCaptureToggle(tabId, false);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (captureMap.get(tabId)) handleCaptureToggle(tabId, false);
});