// goal: Session Manager core logic

export interface TabData {
	url: string;
	title: string;
	pinned: boolean;
}

export interface Session {
	id: string;
	name: string;
	createdAt: number;
	tabs: TabData[];
}

// Get current window tabs
export async function getCurrentTabs(): Promise<TabData[]> {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	return tabs.map(t => ({
		url: t.url || '',
		title: t.title || '',
		pinned: t.pinned
	})).filter(t => t.url && !t.url.startsWith('chrome://'));
}

// Save session
export async function saveSession(name: string): Promise<Session> {
	const tabs = await getCurrentTabs();
	const session: Session = {
		id: crypto.randomUUID(),
		name: name || `Session ${new Date().toLocaleString()}`,
		createdAt: Date.now(),
		tabs
	};

	const sessions = await getSessions();
	sessions.unshift(session);
	await chrome.storage.local.set({ 'halo_sessions': sessions });
	return session;
}

// Get all sessions
export async function getSessions(): Promise<Session[]> {
	const res = await chrome.storage.local.get('halo_sessions');
	return res.halo_sessions || [];
}

// Delete session
export async function deleteSession(id: string): Promise<void> {
	const sessions = await getSessions();
	const newSessions = sessions.filter(s => s.id !== id);
	await chrome.storage.local.set({ 'halo_sessions': newSessions });
}

// Restore session (open all tabs)
// rule: filter tabs to safe URL schemes — without this, a restored session could
// open data: URLs (which can be used to bypass CSP/SB) or other dangerous schemes
// like javascript: that were stored from a compromised session.
const SAFE_SCHEMES = ['http:', 'https:', 'ftp:'];
export async function restoreSession(session: Session, newWindow = false): Promise<void> {
	const safeTabs = session.tabs.filter(t => {
		try { return SAFE_SCHEMES.includes(new URL(t.url).protocol); }
		catch { return false; }
	});

	if (newWindow) {
		await chrome.windows.create({ url: safeTabs.map(t => t.url) });
	} else {
		for (const tab of safeTabs) {
			await chrome.tabs.create({ url: tab.url, active: false, pinned: tab.pinned });
		}
	}
}
