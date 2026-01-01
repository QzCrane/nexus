// goal: Remote module registry client
// eff: Fetch module list from remote server + version check

import { type ModuleMeta, ALL_MODULES } from '../registry/module-registry';

// Remote registry config
const REGISTRY_CONFIG = {
	// GitHub raw file or CDN URL (placeholder - replace with actual URL when ready)
	baseUrl: 'https://raw.githubusercontent.com/user/halo-modules/main',
	registryPath: '/registry.json',
	timeout: 10000, // 10s
	cacheKey: 'halo_remote_registry',
	cacheTTL: 3600000, // 1 hour
};

// Remote registry response structure
export interface RemoteRegistry {
	version: string;
	lastUpdated: string;
	modules: RemoteModuleMeta[];
}

export interface RemoteModuleMeta extends ModuleMeta {
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
		if (REGISTRY_CONFIG.baseUrl.includes('user/halo-modules')) {
			return {
				version: '1.0.0',
				lastUpdated: new Date().toISOString(),
				modules: ALL_MODULES as RemoteModuleMeta[], // Cast is safe as local modules match structure
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
	try {
		const result = await chrome.storage.local.get(REGISTRY_CONFIG.cacheKey);
		return result[REGISTRY_CONFIG.cacheKey] || null;
	} catch {
		return null;
	}
};

// Set cached registry to storage
const setCachedRegistry = async (cached: CachedRegistry): Promise<void> => {
	try {
		await chrome.storage.local.set({ [REGISTRY_CONFIG.cacheKey]: cached });
	} catch (err) {
		console.warn('[RemoteRegistry] Cache error:', err);
	}
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

// Check for module updates
export interface ModuleUpdate {
	id: string;
	currentVersion: string;
	newVersion: string;
	changelog?: string;
}

export const checkForUpdates = async (): Promise<ModuleUpdate[]> => {
	const remote = await fetchRemoteRegistry();
	if (!remote) return [];

	const updates: ModuleUpdate[] = [];

	for (const remoteMod of remote.modules) {
		const localMod = ALL_MODULES.find((m) => m.id === remoteMod.id);
		if (localMod && compareVersions(remoteMod.version, localMod.version) > 0) {
			updates.push({
				id: remoteMod.id,
				currentVersion: localMod.version,
				newVersion: remoteMod.version,
				changelog: remoteMod.changelog,
			});
		}
	}

	return updates;
};

// Get merged modules (local + remote)
export const getMergedModules = async (): Promise<ModuleMeta[]> => {
	const remote = await fetchRemoteRegistry();
	if (!remote) return ALL_MODULES;

	const merged = [...ALL_MODULES];

	// Add new modules from remote that don't exist locally
	for (const remoteMod of remote.modules) {
		if (!merged.find((m) => m.id === remoteMod.id)) {
			merged.push(remoteMod);
		}
	}

	return merged;
};

// Create a fallback local registry (used when remote unavailable)
export const getLocalRegistry = (): RemoteRegistry => ({
	version: '1.0.0',
	lastUpdated: new Date().toISOString(),
	modules: ALL_MODULES as RemoteModuleMeta[],
});
