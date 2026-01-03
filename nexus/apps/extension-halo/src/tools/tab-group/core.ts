// goal: Tab Group core logic

export interface TabGroupInfo {
	id: number;
	title?: string;
	color: string;
	collapsed: boolean;
	tabs: chrome.tabs.Tab[];
}

export async function checkPermission(): Promise<boolean> {
	return new Promise(resolve => {
		chrome.permissions.contains({ permissions: ['tabGroups'] }, resolve);
	});
}

export async function requestPermission(): Promise<boolean> {
	return new Promise(resolve => {
		chrome.permissions.request({ permissions: ['tabGroups'] }, resolve);
	});
}

export async function getGroups(): Promise<TabGroupInfo[]> {
	if (!chrome.tabGroups) return [];

	const groups = await chrome.tabGroups.query({});
	const tabs = await chrome.tabs.query({ currentWindow: true });

	// Map tabs to groups
	const result: TabGroupInfo[] = groups.map(g => ({
		id: g.id,
		title: g.title,
		color: g.color,
		collapsed: g.collapsed,
		tabs: tabs.filter(t => t.groupId === g.id)
	}));

	return result;
}

export async function createGroup(title: string, color: chrome.tabGroups.Color): Promise<void> {
	const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
	if (tabs.length === 0) return;

	const groupId = await (chrome.tabs.group({ tabIds: tabs.map(t => t.id!) as [number, ...number[]] }) as unknown as Promise<number>);
	await chrome.tabGroups.update(groupId, { title, color });
}

export async function ungroup(groupId: number): Promise<void> {
	const tabs = await chrome.tabs.query({ groupId });
	await (chrome.tabs.ungroup(tabs.map(t => t.id!) as [number, ...number[]]));
}

export async function updateGroup(groupId: number, update: { collapsed?: boolean; color?: chrome.tabGroups.Color; title?: string }): Promise<void> {
	await chrome.tabGroups.update(groupId, update);
}
