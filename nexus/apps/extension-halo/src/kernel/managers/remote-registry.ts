import { type ToolMeta, ALL_TOOLS } from '../../kernel';
import { safeStorageGet, safeStorageSet } from '../../kernel/core/safe-storage';

// Remote registry config
const REGISTRY_CONFIG = {
	baseUrl: 'https://raw.githubusercontent.com/user/halo-tools/main',
	registryPath: '/registry.json',
	timeout: 10000, // 10s
	cacheKey: 'halo_remote_registry',
	cacheTTL: 3600000, // 1 hour
};

export interface RemoteRegistry {
	version: string;
	lastUpdated: string;
	tools: RemoteToolMeta[];
}

export interface RemoteToolMeta extends ToolMeta {
	downloadUrl?: string;
	changelog?: string;
	minHaloVersion?: string;
}

// Cached registry state
interface CachedRegistry {
	data: RemoteRegistry;
	fetchedAt: number;
}

// Fetch registry from remote (with cache)
export const fetchRemoteRegistry = async (forceRefresh = false): Promise<RemoteRegistry | null> => {
	try {
		// Dev mode: If using placeholder URL, return local registry immediately to avoid 404s
		if (REGISTRY_CONFIG.baseUrl.includes('user/halo-tools')) {
			return {
				version: '1.0.0',
				lastUpdated: new Date().toISOString(),
				tools: ALL_TOOLS as RemoteToolMeta[], // Cast is safe as local tools match structure
			};
		}

		// Check cache first
		if (!forceRefresh) {
			const cached = await getCachedRegistry();
			if (cached && Date.now() - cached.fetchedAt < REGISTRY_CONFIG.cacheTTL) {
				return cached.data;
			}
		}

		// Fetch from remote
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), REGISTRY_CONFIG.timeout);

		const url = `${REGISTRY_CONFIG.baseUrl}${REGISTRY_CONFIG.registryPath}`;
		const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
		clearTimeout(timeoutId);

		if (!response.ok) {
			console.warn('[RemoteRegistry] Fetch failed:', response.status);
			return null;
		}

		const data: RemoteRegistry = await response.json();

		// Cache the result
		await setCachedRegistry({ data, fetchedAt: Date.now() });

		return data;
	} catch (err) {
		console.warn('[RemoteRegistry] Fetch error:', err);
		return null;
	}
};

// Get cached registry from storage
const getCachedRegistry = async (): Promise<CachedRegistry | null> => {
	const result = await safeStorageGet([REGISTRY_CONFIG.cacheKey], { [REGISTRY_CONFIG.cacheKey]: null }, 'local');
	return result[REGISTRY_CONFIG.cacheKey];
};

// Set cached registry to storage
const setCachedRegistry = async (cached: CachedRegistry): Promise<void> => {
	await safeStorageSet({ [REGISTRY_CONFIG.cacheKey]: cached }, 'local');
};

// Compare versions (simple semver)
export const compareVersions = (v1: string, v2: string): number => {
	const parts1 = v1.split('.').map(Number);
	const parts2 = v2.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const p1 = parts1[i] || 0;
		const p2 = parts2[i] || 0;
		if (p1 > p2) return 1;
		if (p1 < p2) return -1;
	}
	return 0;
};

// Check for tool updates
export interface ToolUpdate {
	id: string;
	currentVersion: string;
	newVersion: string;
	changelog?: string;
}

export const checkForUpdates = async (): Promise<ToolUpdate[]> => {
	const remote = await fetchRemoteRegistry();
	if (!remote) return [];

	const updates: ToolUpdate[] = [];

	for (const remoteTool of remote.tools) {
		const localTool = ALL_TOOLS.find((t) => t.id === remoteTool.id);
		const rv = remoteTool.version || '0.0.0';
		const lv = localTool?.version || '0.0.0';

		if (localTool && compareVersions(rv, lv) > 0) {
			updates.push({
				id: remoteTool.id,
				currentVersion: lv,
				newVersion: rv,
				changelog: remoteTool.changelog,
			});
		}
	}

	return updates;
};

// Get merged tools (local + remote)
export const getMergedTools = async (): Promise<ToolMeta[]> => {
	const remote = await fetchRemoteRegistry();
	if (!remote) return ALL_TOOLS;

	const merged = [...ALL_TOOLS];

	// Add new tools from remote that don't exist locally
	for (const remoteTool of remote.tools) {
		if (!merged.find((t) => t.id === remoteTool.id)) {
			merged.push(remoteTool);
		}
	}

	return merged;
};

// Create a fallback local registry (used when remote unavailable)
export const getLocalRegistry = (): RemoteRegistry => ({
	version: '1.0.0',
	lastUpdated: new Date().toISOString(),
	tools: ALL_TOOLS as RemoteToolMeta[],
});
