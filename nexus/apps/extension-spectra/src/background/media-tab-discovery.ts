// goal: coalesce bounded media inventory reads while retaining permits for physically unsettled receivers
// inv: timeout reports a partial inventory; it never turns old replies into current media or an occupied slot into free capacity

import { createSettlementPool, observeWithin } from '@nexus/kernel';

export interface MediaTabInventory {
	tabs: number[];
	incomplete?: boolean;
}

export interface MediaDiscoveryDependencies {
	queryTabs(): Promise<chrome.tabs.Tab[]>;
	seed(tabs: readonly chrome.tabs.Tab[], now: number): Set<number>;
	probe(tabId: number): Promise<boolean>;
}

export interface MediaDiscoveryPolicy {
	concurrency: number;
	probeTimeoutMs: number;
	scanTimeoutMs: number;
}

// Deadlines are availability limits, not measured latency SLOs. A still-live
// Chrome request retains its physical permit after the observer stops waiting.
const DEFAULT_POLICY: MediaDiscoveryPolicy = {
	concurrency: 8,
	probeTimeoutMs: 1_500,
	scanTimeoutMs: 5_000,
};

function canProbe(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url) return false;
	try { return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol); }
	catch { return false; }
}

export function createMediaTabDiscovery(
	dependencies: MediaDiscoveryDependencies,
	policy: MediaDiscoveryPolicy = DEFAULT_POLICY,
): (now?: number) => Promise<MediaTabInventory> {
	if (!Number.isFinite(policy.probeTimeoutMs) || policy.probeTimeoutMs <= 0
		|| !Number.isFinite(policy.scanTimeoutMs) || policy.scanTimeoutMs <= 0) {
		throw new Error('media discovery deadlines must be finite and positive');
	}
	const probes = createSettlementPool<number, boolean>(policy.concurrency);
	const queries = createSettlementPool<'tabs', chrome.tabs.Tab[]>(1);
	let currentScan: Promise<MediaTabInventory> | null = null;

	const scan = async (now: number): Promise<MediaTabInventory> => {
		const deadline = performance.now() + policy.scanTimeoutMs;
		const query = queries.getOrStart('tabs', dependencies.queryTabs);
		if (!query) throw new Error('media inventory query capacity unavailable');
		const live = await observeWithin(query, policy.scanTimeoutMs);
		if (!live.settled) throw new Error('media inventory query timed out');
		const visible = dependencies.seed(live.value, now);
		const candidates = live.value.filter((tab) => canProbe(tab) && !visible.has(tab.id));
		let next = 0;
		let incomplete = false;
		const worker = async () => {
			while (next < candidates.length) {
				const remaining = deadline - performance.now();
				if (remaining <= 0) { incomplete = true; return; }
				const tab = candidates[next++];
				if (tab?.id === undefined) continue;
				const operation = probes.getOrStart(tab.id, () => dependencies.probe(tab.id as number));
				if (!operation) { incomplete = true; return; }
				try {
					const result = await observeWithin(operation, Math.min(remaining, policy.probeTimeoutMs));
					if (!result.settled) { incomplete = true; return; }
					if (result.value) visible.add(tab.id);
				} catch {
					// Unexpected probe failure does not turn a partial scan into a complete success.
					incomplete = true;
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(policy.concurrency, candidates.length) }, worker));
		const tabs = [...visible].sort((left, right) => left - right);
		// The wire contract explicitly caps a response at 10,000 unique tabs.
		if (tabs.length > 10_000) { tabs.length = 10_000; incomplete = true; }
		return incomplete ? { tabs, incomplete: true } : { tabs };
	};
	return (now = Date.now()) => {
		if (currentScan) return currentScan;
		const operation = scan(now);
		currentScan = operation;
		const release = () => { if (currentScan === operation) currentScan = null; };
		void operation.then(release, release);
		return operation;
	};
}
