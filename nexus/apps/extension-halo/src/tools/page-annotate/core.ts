// goal: Page Annotate core logic

export function startAnnotation(): Promise<void> {
	return new Promise((resolve) => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_ANNOTATE_START' }).then(() => resolve()).catch(() => resolve());
			} else {
				resolve();
			}
		});
	});
}

export function stopAnnotation(): Promise<void> {
	return new Promise((resolve) => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'HALO_ANNOTATE_STOP' }).then(() => resolve()).catch(() => resolve());
			} else {
				resolve();
			}
		});
	});
}
