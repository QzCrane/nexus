// goal: Session Manager core logic — one persisted session list, conditional
// cross-context mutations, pinned-preserving restore with per-tab results

import { conditionalLedgerWrite, readLedgerEntry } from '@nexus/kernel';

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

export interface RestoreFailure {
	url: string;
	title: string;
	reason: string;
}

export interface RestoreReport {
	sessionId: string;
	restored: number;
	pinned: number;
	failed: RestoreFailure[];
}

export const SESSIONS_STORAGE_KEY = 'halo_sessions';
export const MAX_SESSIONS = 50;
export const MAX_SESSION_TABS = 500;
export const MAX_SESSIONS_BYTES = 1024 * 1024;

/**
 * Sole missing/malformed-storage policy for the persisted session list.
 * Entries that do not satisfy the domain contract are dropped, never
 * shape-coerced; tabs beyond the per-session ceiling are truncated.
 */
export function parseSessions(value: unknown): Session[] {
	if (!Array.isArray(value)) return [];
	const sessions: Session[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
		const candidate = entry as Record<string, unknown>;
		if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue;
		if (typeof candidate.name !== 'string') continue;
		if (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)) continue;
		if (!Array.isArray(candidate.tabs)) continue;
		const tabs: TabData[] = [];
		for (const tabValue of candidate.tabs.slice(0, MAX_SESSION_TABS)) {
			if (typeof tabValue !== 'object' || tabValue === null || Array.isArray(tabValue)) continue;
			const tab = tabValue as Record<string, unknown>;
			if (typeof tab.url !== 'string' || tab.url.length === 0) continue;
			tabs.push({
				url: tab.url,
				title: typeof tab.title === 'string' ? tab.title : '',
				pinned: tab.pinned === true,
			});
		}
		sessions.push({ id: candidate.id, name: candidate.name, createdAt: candidate.createdAt, tabs });
	}
	return sessions;
}

function sessionsBytes(sessions: Session[]): number {
	return new TextEncoder().encode(JSON.stringify(sessions)).byteLength;
}

/**
 * Keep the newest sessions within the entry and byte ceilings. Pinned tab data
 * is retained per session; whole sessions are dropped oldest-first.
 */
export function admitSessions(sessions: Session[]): Session[] {
	let kept = sessions.slice(0, MAX_SESSIONS);
	// Drop oldest sessions until the encoded list fits. The newest session is
	// always retained, even when it alone exceeds the byte ceiling.
	while (kept.length > 1 && sessionsBytes(kept) > MAX_SESSIONS_BYTES) {
		kept = kept.slice(0, -1);
	}
	return kept;
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

const MAX_MUTATION_ATTEMPTS = 3;

async function mutateSessions(mutate: (sessions: Session[]) => Session[]): Promise<Session[]> {
	let base = await readLedgerEntry(SESSIONS_STORAGE_KEY, { area: 'local' });
	for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt++) {
		const next = admitSessions(mutate(parseSessions(base.value)));
		const outcome = await conditionalLedgerWrite(SESSIONS_STORAGE_KEY, {
			area: 'local',
			baseRevision: base.revision,
			value: next,
			remerge: (current, remergeAttempt) => {
				if (remergeAttempt >= MAX_MUTATION_ATTEMPTS) return null;
				return admitSessions(mutate(parseSessions(current)));
			},
		});
		if (outcome.kind === 'committed') return parseSessions(outcome.value);
		if (outcome.kind === 'external') {
			if (outcome.revision === base.revision) return parseSessions(base.value);
			base = { value: parseSessions(outcome.value), revision: outcome.revision };
			continue;
		}
		throw new Error('Session list update was not committed; the stored list is unchanged.');
	}
	return parseSessions(base.value);
}

// Save session
export async function saveSession(name: string): Promise<{ session: Session; sessions: Session[] }> {
	const tabs = await getCurrentTabs();
	const session: Session = {
		id: crypto.randomUUID(),
		name: name || `Session ${new Date().toLocaleString()}`,
		createdAt: Date.now(),
		tabs
	};

	const sessions = await mutateSessions((stored) => [session, ...stored]);
	return { session, sessions };
}

// Get all sessions
export async function getSessions(): Promise<Session[]> {
	const entry = await readLedgerEntry(SESSIONS_STORAGE_KEY, { area: 'local' });
	return parseSessions(entry.value);
}

// Delete session
export async function deleteSession(id: string): Promise<Session[]> {
	return mutateSessions((stored) => stored.filter(s => s.id !== id));
}

// Restore session (open all tabs)
// rule: filter tabs to safe URL schemes — without this, a restored session could
// open data: URLs (which can be used to bypass CSP/SB) or other dangerous schemes
// like javascript: that were stored from a compromised session.
const SAFE_SCHEMES = ['http:', 'https:', 'ftp:'];

/**
 * Restore every safe tab of the session and report per-tab results. A failed
 * tab is listed with its reason instead of turning the whole request into a
 * silent partial success. The new-window path recreates pinned state per tab.
 */
export async function restoreSession(session: Session, newWindow = false): Promise<RestoreReport> {
	const report: RestoreReport = { sessionId: session.id, restored: 0, pinned: 0, failed: [] };
	const safeTabs = session.tabs.filter(t => {
		try { return SAFE_SCHEMES.includes(new URL(t.url).protocol); }
		catch { return false; }
	});

	if (newWindow) {
		const firstTab = safeTabs[0];
		if (!firstTab) return report;
		let windowId: number | undefined;
		try {
			const created = await chrome.windows.create({ url: firstTab.url });
			if (!created || created.id === undefined) throw new Error('window creation returned no window id');
			windowId = created.id;
			report.restored++;
			const createdTabId = created.tabs?.[0]?.id;
			if (firstTab.pinned) {
				if (createdTabId === undefined) {
					report.failed.push({ url: firstTab.url, title: firstTab.title, reason: 'created window did not report its first tab; pinned state was not applied' });
				} else {
					try {
						await chrome.tabs.update(createdTabId, { pinned: true });
						report.pinned++;
					} catch (pinError) {
						report.failed.push({ url: firstTab.url, title: firstTab.title, reason: String(pinError) });
					}
				}
			}
		} catch (error) {
			report.failed.push({ url: firstTab.url, title: firstTab.title, reason: String(error) });
		}
		if (windowId === undefined) {
			for (const tab of safeTabs.slice(1)) {
				report.failed.push({ url: tab.url, title: tab.title, reason: 'window id missing' });
			}
			return report;
		}
		for (const tab of safeTabs.slice(1)) {
			try {
				await chrome.tabs.create({ windowId, url: tab.url, active: false, pinned: tab.pinned });
				report.restored++;
				if (tab.pinned) report.pinned++;
			} catch (error) {
				report.failed.push({ url: tab.url, title: tab.title, reason: String(error) });
			}
		}
		return report;
	}

	for (const tab of safeTabs) {
		try {
			await chrome.tabs.create({ url: tab.url, active: false, pinned: tab.pinned });
			report.restored++;
			if (tab.pinned) report.pinned++;
		} catch (error) {
			report.failed.push({ url: tab.url, title: tab.title, reason: String(error) });
		}
	}
	return report;
}
