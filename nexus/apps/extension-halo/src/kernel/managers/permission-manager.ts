
// goal: System-level permission management
// desc: Centralizes Chrome permission handling, definitions, and event monitoring

export interface PermissionDef {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: 'basic' | 'advanced' | 'privacy';
	requiredBy: string[];   // Which features require this permission
}

export interface PermissionState {
	id: string;
	granted: boolean;
}

// All available optional permissions with descriptions
export const OPTIONAL_PERMISSIONS: PermissionDef[] = [
	{
		id: 'pageCapture',
		name: 'Page Capture',
		description: 'Save complete web pages as MHTML files',
		icon: '📥',
		category: 'basic',
		requiredBy: ['archive'],
	},
	{
		id: 'webNavigation',
		name: 'Web Navigation',
		description: 'Detect page navigation for UserScripts injection',
		icon: '🧭',
		category: 'basic',
		requiredBy: ['userscripts'],
	},
	{
		id: 'clipboardRead',
		name: 'Clipboard Read',
		description: 'Read text from your clipboard',
		icon: '📋',
		category: 'privacy',
		requiredBy: ['clipboard'],
	},
	{
		id: 'clipboardWrite',
		name: 'Clipboard Write',
		description: 'Copy text to your clipboard',
		icon: '📝',
		category: 'basic',
		requiredBy: ['clipboard', 'qrcode', 'color-picker'],
	},
	{
		id: 'downloads',
		name: 'Downloads',
		description: 'Manage file downloads',
		icon: '⬇️',
		category: 'basic',
		requiredBy: ['pdf', 'archive'],
	},
	{
		id: 'history',
		name: 'History',
		description: 'Access browsing history',
		icon: '🕐',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'bookmarks',
		name: 'Bookmarks',
		description: 'Access and manage bookmarks',
		icon: '⭐',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'topSites',
		name: 'Top Sites',
		description: 'Access most visited sites data',
		icon: '📊',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'notifications',
		name: 'Notifications',
		description: 'Show desktop notifications',
		icon: '🔔',
		category: 'basic',
		requiredBy: [],
	},
];

// All hosts permission (for UserScripts injection to any site)
export const HOST_PERMISSIONS: PermissionDef = {
	id: '*://*/*',
	name: 'All Websites',
	description: 'Allow script injection on any website (required for UserScripts)',
	icon: '🌐',
	category: 'advanced',
	requiredBy: ['userscripts'],
};

export class PermissionManager {
	private listeners: Set<() => void> = new Set();

	constructor() {
		this.init();
	}

	private init() {
		// Monitor permission changes
		chrome.permissions.onAdded.addListener(this.notify);
		chrome.permissions.onRemoved.addListener(this.notify);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify = () => {
		this.listeners.forEach((l) => l());
	};

	// Check if a permission is granted
	async check(permission: string): Promise<boolean> {
		try {
			return await chrome.permissions.contains({ permissions: [permission] });
		} catch {
			return false;
		}
	}

	// Check if a host permission is granted
	async checkHost(origin: string): Promise<boolean> {
		try {
			return await chrome.permissions.contains({ origins: [origin] });
		} catch {
			return false;
		}
	}

	// Get all permission states
	async getAllStates(): Promise<PermissionState[]> {
		const results: PermissionState[] = [];

		for (const perm of OPTIONAL_PERMISSIONS) {
			const granted = await this.check(perm.id);
			results.push({ id: perm.id, granted });
		}

		// Check host permission
		const hostGranted = await this.checkHost(HOST_PERMISSIONS.id);
		results.push({ id: HOST_PERMISSIONS.id, granted: hostGranted });

		return results;
	}

	// Request a permission
	async request(permission: string): Promise<boolean> {
		try {
			const granted = await chrome.permissions.request({ permissions: [permission] });
			if (granted) this.notify();
			return granted;
		} catch (e) {
			console.error('[PermissionManager] Request failed:', e);
			return false;
		}
	}

	// Request host permission
	async requestHost(origin: string): Promise<boolean> {
		try {
			const granted = await chrome.permissions.request({ origins: [origin] });
			if (granted) this.notify();
			return granted;
		} catch (e) {
			console.error('[PermissionManager] Host request failed:', e);
			return false;
		}
	}

	// Revoke a permission
	async revoke(permission: string): Promise<boolean> {
		try {
			const removed = await chrome.permissions.remove({ permissions: [permission] });
			if (removed) this.notify();
			return removed;
		} catch (e) {
			console.error('[PermissionManager] Revoke failed:', e);
			return false;
		}
	}

	// Revoke host permission
	async revokeHost(origin: string): Promise<boolean> {
		try {
			const removed = await chrome.permissions.remove({ origins: [origin] });
			if (removed) this.notify();
			return removed;
		} catch (e) {
			console.error('[PermissionManager] Host revoke failed:', e);
			return false;
		}
	}

	// Get permissions required for a specific feature
	getRequiredPermissions(featureId: string): PermissionDef[] {
		const required = OPTIONAL_PERMISSIONS.filter((p) => p.requiredBy.includes(featureId));
		if (HOST_PERMISSIONS.requiredBy.includes(featureId)) {
			required.push(HOST_PERMISSIONS);
		}
		return required;
	}
}

let instance: PermissionManager | null = null;
export const getPermissionManager = (): PermissionManager => {
	if (!instance) {
		instance = new PermissionManager();
	}
	return instance;
};
