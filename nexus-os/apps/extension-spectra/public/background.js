// 导入配置中心
importScripts('config.js');

let captureMap = new Map();
let captureLocks = new Map(); // Mutex locks to prevent race conditions on same tab
let badgeState = new Map(); // 用于跟踪每个标签页的角标状态
// ============================================
// 角标更新功能
// ============================================
/**
 * 更新指定标签页的插件图标角标
 * @param {number} tabId - 标签页ID
 * @param {number} volume - 音量值 (0-800)
 * @param {boolean} muted - 是否静音
 * @param {boolean} isCapture - 是否为劫持模式（用于决定颜色）
 */
async function updateBadge(tabId, volume, muted, isCapture) {
    if (!tabId) return;
    
    // 先验证标签页是否存在，防止操作已关闭的标签页
    try {
        await chrome.tabs.get(tabId);
    } catch (e) {
        // 标签页不存在，清理状态并退出
        badgeState.delete(tabId);
        return;
    }
    
    let badgeText = '';
    let badgeColor = isCapture ? CONFIG.COLORS.CAPTURE : CONFIG.COLORS.NATIVE; // 劫持=紫色，原生=蓝色
    
    if (muted || volume === 0) {
        badgeText = 'M'; // 静音时显示 M
        badgeColor = CONFIG.COLORS.MUTED; // 灰色
    } else {
        // 显示音量数字
        badgeText = volume.toString();
    }
    
    // 更新状态
    badgeState.set(tabId, { volume, muted, isCapture, text: badgeText });
    
    // 设置角标文本和颜色（添加错误处理防止标签页在验证后被关闭的竞态情况）
    try {
        await chrome.action.setBadgeText({ tabId, text: badgeText });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
        await chrome.action.setBadgeTextColor({ tabId, color: CONFIG.COLORS.WHITE });
    } catch (e) {
        // 标签页可能在设置过程中被关闭，忽略错误
        badgeState.delete(tabId);
    }
}

/**
 * 清除指定标签页的角标
 * @param {number} tabId - 标签页ID
 */
function clearBadge(tabId) {
    if (!tabId) return;
    badgeState.delete(tabId);
    // 添加错误处理，防止标签页不存在时抛出错误
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

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
        await new Promise(resolve => setTimeout(resolve, CONFIG.TIMING.MUTEX_POLL_INTERVAL));
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
    
    // 自动添加域名到劫持列表
    if (msg.action === "addToRegistry") {
        const domain = msg.domain;
        if (!domain) {
            sendResponse({ success: false });
            return true;
        }
        
        chrome.storage.local.get(['userRegistry'], (res) => {
            const registry = res.userRegistry || [];
            // 检查是否已存在（包括子域名匹配）
            const exists = registry.some(d => domain.includes(d) || d.includes(domain));
            if (exists) {
                sendResponse({ success: false, reason: 'exists' });
                return;
            }
            
            // 添加到列表
            registry.push(domain);
            chrome.storage.local.set({ userRegistry: registry }, () => {
                sendResponse({ success: true });
            });
        });
        return true; // 保持消息通道开启
    }
    
    // 更新角标（全局，不分模式、网站、音量）
    if (msg.action === "updateBadge") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId && msg.volume !== undefined) {
            updateBadge(targetTabId, msg.volume, msg.muted || false, msg.isCapture || false);
        }
        return true;
    }
    
    // 清除角标
    if (msg.action === "clearBadge") {
        const targetTabId = msg.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId) {
            clearBadge(targetTabId);
        }
        return true;
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
    if (changeInfo.status === 'loading') {
        // 页面重新加载时清除角标
        clearBadge(tabId);
        
        if (captureMap.get(tabId)) {
            console.log(`[VM] Tab ${tabId} reloading, force stopping capture.`);
            handleCaptureToggle(tabId, false);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    // 标签页关闭时清理状态
    clearBadge(tabId);
    if (captureMap.get(tabId)) handleCaptureToggle(tabId, false);
});