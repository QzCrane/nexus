// goal: DOM Selector core logic (Message Proxy)

export async function startSelection(): Promise<void> {
	try {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			await chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_DOM_SELECTOR_START' });
		}
	} catch (err) {
		console.warn('Failed to start selection:', err);
	}
}

export async function stopSelection(): Promise<void> {
	try {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			await chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_DOM_SELECTOR_STOP' });
		}
	} catch (err) {
		console.warn('Failed to stop selection:', err);
	}
}
