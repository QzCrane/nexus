// goal: DOM Selector core logic (Message Proxy)

export function startSelection(): Promise<void> {
	return new Promise((resolve) => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_DOM_SELECTOR_START' }, () => resolve());
			} else {
				resolve();
			}
		});
	});
}

export function stopSelection(): Promise<void> {
	return new Promise((resolve) => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_DOM_SELECTOR_STOP' }, () => resolve());
			} else {
				resolve();
			}
		});
	});
}
