chrome.commands.onCommand.addListener(async (command) => {
    try {
        // 优雅实现：只控制当前焦点窗口的激活标签
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "shortcutTrigger", command: command }).catch(()=>{
                // 忽略无法发送消息的标签（如 chrome:// 页面）
            });
        }
    } catch (e) {}
});