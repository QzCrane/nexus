// goal: coalesce document-fenced media inventory reads while retaining permits for physically unsettled receivers
// inv: only a complete successful observation proves no media; pending or failed coverage is always explicit

import { createSettlementPool, observeWithin } from '@nexus/kernel';

export type MediaProbeOutcome = 'found' | 'no-media' | 'denied' | 'stale' | 'unknown';
export interface MediaProbeResult { outcome: MediaProbeOutcome; documentId: string | null }
export interface MediaInventoryCoverage {
	status: 'complete' | 'degraded'; total: number; examined: number; pending: number;
	failed: number; denied: number; stale: number; unknown: number;
}
export interface MediaTabInventory { tabs: number[]; coverage: MediaInventoryCoverage }
export interface MediaDiscoveryDiagnostics {
	pendingCount: number; oldestPendingMs: number | null; scanCount: number;
	queryFailureCount: number; probeTimeoutCount: number; deniedCount: number;
	staleCount: number; unknownCount: number; lastCoverageComplete: boolean | null;
}
export interface MediaDiscoveryDependencies {
	queryTabs(): Promise<chrome.tabs.Tab[]>;
	seed(tabs: readonly chrome.tabs.Tab[], now: number): Set<number>;
	documentGeneration(tabId: number): number;
	probe(tabId: number, generation: number): Promise<MediaProbeResult>;
}
export interface MediaDiscoveryPolicy { concurrency: number; probeTimeoutMs: number; scanTimeoutMs: number }
export interface MediaTabDiscovery {
	(now?: number): Promise<MediaTabInventory>;
	diagnostics(now?: number): MediaDiscoveryDiagnostics;
}

const DEFAULT_POLICY: MediaDiscoveryPolicy = { concurrency: 8, probeTimeoutMs: 1_500, scanTimeoutMs: 5_000 };
const MAX_COUNT = 10_000;

function probeable(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url) return false;
	try { return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol); }
	catch { return false; }
}
function increment(value: number): number { return Math.min(Number.MAX_SAFE_INTEGER, value + 1); }

export function createMediaTabDiscovery(
	dependencies: MediaDiscoveryDependencies,
	policy: MediaDiscoveryPolicy = DEFAULT_POLICY,
): MediaTabDiscovery {
	if (!Number.isSafeInteger(policy.concurrency) || policy.concurrency < 1
		|| !Number.isFinite(policy.probeTimeoutMs) || policy.probeTimeoutMs <= 0
		|| !Number.isFinite(policy.scanTimeoutMs) || policy.scanTimeoutMs <= 0) {
		throw new Error('media discovery policy must be finite and positive');
	}
	const probes = createSettlementPool<string, MediaProbeResult>(policy.concurrency);
	const queries = createSettlementPool<'tabs', chrome.tabs.Tab[]>(1);
	let currentScan: Promise<MediaTabInventory> | null = null;
	let cursor = 0;
	let scanCount = 0;
	let queryFailureCount = 0;
	let probeTimeoutCount = 0;
	let deniedCount = 0;
	let staleCount = 0;
	let unknownCount = 0;
	let lastCoverageComplete: boolean | null = null;

	const scan = async (now: number): Promise<MediaTabInventory> => {
		scanCount = increment(scanCount);
		const deadline = performance.now() + policy.scanTimeoutMs;
		const query = queries.getOrStart('tabs', dependencies.queryTabs);
		if (!query) { queryFailureCount = increment(queryFailureCount); throw new Error('media inventory query capacity unavailable'); }
		const live = await observeWithin(query, policy.scanTimeoutMs).catch((error: unknown) => {
			queryFailureCount = increment(queryFailureCount); throw error;
		});
		if (!live.settled) { queryFailureCount = increment(queryFailureCount); throw new Error('media inventory query timed out'); }
		const unique = new Map<number, chrome.tabs.Tab>();
		for (const tab of live.value) {
			if (Number.isSafeInteger(tab.id) && Number(tab.id) > 0 && unique.size < MAX_COUNT) unique.set(Number(tab.id), tab);
		}
		const allTabs = [...unique.values()];
		const visible = dependencies.seed(allTabs, now);
		const offset = allTabs.length === 0 ? 0 : cursor % allTabs.length;
		const ordered = [...allTabs.slice(offset), ...allTabs.slice(0, offset)];
		if (allTabs.length > 0) cursor = (cursor + policy.concurrency) % allTabs.length;
		const coverage = { total: allTabs.length, examined: 0, pending: 0, denied: 0, stale: 0, unknown: 0 };
		let next = 0;
		const worker = async () => {
			while (next < ordered.length) {
				const remaining = deadline - performance.now();
				if (remaining <= 0) return;
				const tab = ordered[next++];
				if (!tab?.id) continue;
				if (!probeable(tab)) {
					visible.delete(tab.id);
					coverage.denied++;
					deniedCount = increment(deniedCount);
					continue;
				}
				if (visible.has(tab.id)) { coverage.examined++; continue; }
				const generation = dependencies.documentGeneration(tab.id);
				const key = `${tab.id}:${generation}`;
				if (probes.getPending(key)) { coverage.pending++; continue; }
				const operation = probes.getOrStart(key, () => dependencies.probe(tab.id, generation));
				if (!operation) { coverage.pending++; continue; }
				try {
					const result = await observeWithin(operation, Math.min(remaining, policy.probeTimeoutMs));
					if (!result.settled) { coverage.pending++; probeTimeoutCount = increment(probeTimeoutCount); continue; }
					if (generation !== dependencies.documentGeneration(tab.id) || result.value.outcome === 'stale') {
						coverage.stale++; staleCount = increment(staleCount);
					} else if (result.value.outcome === 'denied') {
						coverage.denied++; deniedCount = increment(deniedCount);
					} else if (result.value.outcome === 'unknown') {
						coverage.unknown++; unknownCount = increment(unknownCount);
					} else {
						coverage.examined++;
						if (result.value.outcome === 'found') visible.add(tab.id);
					}
				} catch { coverage.unknown++; unknownCount = increment(unknownCount); }
			}
		};
		await Promise.all(Array.from({ length: Math.min(policy.concurrency, ordered.length) }, worker));
		const accounted = coverage.examined + coverage.pending + coverage.denied + coverage.stale + coverage.unknown;
		if (accounted < coverage.total) coverage.pending += coverage.total - accounted;
		const failed = coverage.pending + coverage.denied + coverage.stale + coverage.unknown;
		lastCoverageComplete = failed === 0;
		return {
			tabs: [...visible].filter((tabId) => unique.has(tabId)).sort((left, right) => left - right),
			coverage: { status: failed === 0 ? 'complete' : 'degraded', ...coverage, failed },
		};
	};
	const discover = ((now = Date.now()) => {
		if (currentScan) return currentScan;
		const operation = scan(now);
		currentScan = operation;
		const release = () => { if (currentScan === operation) currentScan = null; };
		void operation.then(release, release);
		return operation;
	}) as MediaTabDiscovery;
	discover.diagnostics = (now = performance.now()) => {
		const pending = probes.readPending();
		const oldest = pending.reduce<number | null>((value, item) => value === null ? item.startedAt : Math.min(value, item.startedAt), null);
		return {
			pendingCount: pending.length,
			oldestPendingMs: oldest === null ? null : Math.max(0, now - oldest),
			scanCount, queryFailureCount, probeTimeoutCount, deniedCount, staleCount, unknownCount, lastCoverageComplete,
		};
	};
	return discover;
}
