// goal: resolve one tab's current top-level document identity without acquiring runtime state
// inv: frameId is not a navigation identity; callers receive only a non-empty documentId or null

export async function currentTopDocumentId(tabId: number): Promise<string | null> {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) return null;
	try {
		const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
		const documentId = frame?.documentId;
		return typeof documentId === 'string' && documentId.length > 0 ? documentId : null;
	} catch {
		return null;
	}
}

export async function isCurrentTopDocument(tabId: number, documentId: string): Promise<boolean> {
	return documentId.length > 0 && await currentTopDocumentId(tabId) === documentId;
}
