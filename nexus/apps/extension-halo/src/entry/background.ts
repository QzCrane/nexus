// HALO Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
	console.log('[HALO] Extension installed');

	// 初始化默认设置
	chrome.storage.sync.get(['halo_dark_mode'], (result) => {
		if (result.halo_dark_mode === undefined) {
			chrome.storage.sync.set({ halo_dark_mode: false });
		}
	});
});
