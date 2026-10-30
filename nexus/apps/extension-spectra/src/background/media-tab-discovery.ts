// goal: coalesce document-fenced media inventory reads while retaining permits for physically unsettled receivers
// inv: only a complete successful observation proves no media; pending or failed coverage is always explicit

import { createSettlementPool, observeWithin } from '@nexus/kernel';
import type { MediaFact, MediaProbeCooldown, MediaProbeCooldownOutcome } from './media-facts';

/**
 * A probe can end in exactly two kinds of place: a fact (durable, `found` /
 * `no-media`) or a transient outcome that only earns a cooldown. Deriving the
 * union keeps those three declarations from drifting apart — adding a transient
 * outcome to the cooldown type extends the probe result by construction, instead
 * of silently leaving a value the probe may return but the cooldown may not
 * record.
 */
export type MediaProbeOutcome =
	| MediaFact['outcome']
	| Exclude<MediaProbeCooldownOutcome, 'pending'>;
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
	/** Solidified media fact (null when absent) - a current fact skips probing. */
	readFact(tabId: number): MediaFact | null;
	/** found is durable for its own document; no-media is only current within its TTL. */
	isFactCurrent(fact: MediaFact, now?: number): boolean;
	/** Solidify a fact only on probe settle to found/no-media; never for transient results. */
	rememberFact(tabId: number, documentId: string | null, outcome: 'found' | 'no-media', source: 'report' | 'probe'): void;
	/** Durable transient-failure cooldown (null when absent). */
	readCooldown(tabId: number): MediaProbeCooldown | null;
	/** Record a transient failure with its absolute expiry timestamp. */
	rememberCooldown(tabId: number, outcome: MediaProbeCooldownOutcome, until: number): void;
	/** Clear a cooldown (navigation invalidation or settled success). */
	forgetCooldown(tabId: number): void;
}
export interface MediaDiscoveryPolicy { concurrency: number; probeTimeoutMs: number; scanTimeoutMs: number }
export interface MediaTabDiscovery {
	(now?: number): Promise<MediaTabInventory>;
	/** Non-blocking projection of currently known media tabs (facts + seeds only). */
	readNow(now?: number): Promise<MediaTabInventory>;
	diagnostics(now?: number): MediaDiscoveryDiagnostics;
}

const DEFAULT_POLICY: MediaDiscoveryPolicy = { concurrency: 8, probeTimeoutMs: 500, scanTimeoutMs: 5_000 };
const MAX_COUNT = 10_000;
// A transient failure (denied/stale/unknown/timeout) is never a fact. Its
// cooldown is durable: a service-worker restart must not re-probe the same
// failing tabs on every popup open.
const TRANSIENT_FAILURE_COOLDOWN_MS = 30_000;
// A denied tab cannot be injected into (file:// without file access, incognito,
// permission gaps). It is not part of the controllable inventory and is excluded
// from coverage after the first denied probe, like restricted/discarded pages.
const DENIED_COOLDOWN_MS = 10 * 60 * 1000;

function probeable(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url) return false;
	try { return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol); }
	catch { return false; }
}
// Discarded tabs are unloaded: their renderer is suspended, so they cannot host
// active media, and probing them would force Chrome to wake (reload) the page.
// A tab that is still committing a document is in the same position for a
// different reason: the media it will host does not exist yet, and whatever the
// previous document reported belongs to a page that is already gone. Both are
// excluded from probing, the visible set, and coverage entirely, so neither can
// appear as a card the user cannot act on.
//
// `audible` is the one exception, because it is Chrome's own statement that
// sound is coming out of the tab right now: a page that keeps a request open
// past its load event still belongs in the list, a page that has not committed
// yet never does.
function probeableNow(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	const documentSettled = tab.status === 'complete' || tab.audible === true;
	return probeable(tab) && tab.discarded !== true && documentSettled;
}
function increment(value: number): number { return Math.min(Number.MAX_SAFE_INTEGER, value + 1); }

export function createMediaTabDiscovery(
	dependencies: MediaDiscoveryDependencies,
	policy: MediaDiscoveryPolicy = DEFAULT_POLICY,
): MediaTabDiscovery {
	if (!Number.isSafeInteger(policy.concurrency) || policy.concurrency < 1
		|| !Number.isFinite(policy.probeTimeoutMs) || policy.probeTimeoutMs <= 0
		|| !Number.isFinite(policy.scanTimeoutMs) || policy.scanTimeoutMs <= 0) {
		throw new Error('media discovery policy invalid');
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

	// A durably denied tab cannot be injected into and is therefore outside the
	// controllable inventory. Exclude it from probing and coverage entirely:
	// its presence must never degrade an honest inventory.
	const isControllable = (tab: chrome.tabs.Tab & { id: number }, now: number): boolean => {
		const cooldown = dependencies.readCooldown(tab.id);
		return !cooldown || now >= cooldown.until || cooldown.outcome !== 'denied';
	};

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
		// Extension-internal, restricted (chrome://, etc.) and discarded (suspended,
		// renderer unloaded) pages cannot host controllable active media and are
		// not probeable. Drop them from the visible set and exclude them from
		// coverage entirely: their presence must never degrade a complete inventory.
		const probeableTabs = allTabs.filter(probeableNow);
		for (const tab of allTabs) {
			if (probeableNow(tab) || tab.id === undefined) continue;
			visible.delete(tab.id);
		}
		const controllable = probeableTabs.filter((tab) => isControllable(tab, now));
		const offset = controllable.length === 0 ? 0 : cursor % controllable.length;
		const ordered = [...controllable.slice(offset), ...controllable.slice(0, offset)];
		if (controllable.length > 0) cursor = (cursor + policy.concurrency) % controllable.length;
		const coverage = { total: controllable.length, examined: 0, pending: 0, denied: 0, stale: 0, unknown: 0 };
		let next = 0;
		const worker = async () => {
			while (next < ordered.length) {
				const remaining = deadline - performance.now();
				if (remaining <= 0) return;
				const tab = ordered[next++];
				if (!tab) continue;
				if (visible.has(tab.id)) { coverage.examined++; continue; }
				// A solidified fact skips probing: found counts as visible and
				// no-media counts as examined. The probe result is persisted once
				// and reused by every later scan (never re-decided per scan).
				const generation = dependencies.documentGeneration(tab.id);
				const fact = dependencies.readFact(tab.id);
				if (fact && dependencies.isFactCurrent(fact)) {
					if (fact.outcome === 'found') visible.add(tab.id);
					coverage.examined++;
					continue;
				}
				const key = `${tab.id}:${generation}`;
				if (probes.getPending(key)) { coverage.pending++; continue; }
				// A tab that just failed (denied/stale/unknown/timeout) is projected
				// from its durable cooldown instead of being probed again: one
				// permanently failing tab must not stall every scan nor degrade it
				// repeatedly across service-worker restarts.
				const cooldown = dependencies.readCooldown(tab.id);
				if (cooldown && now < cooldown.until) {
					coverage[cooldown.outcome]++;
					continue;
				}
				if (cooldown) dependencies.forgetCooldown(tab.id);
				const operation = probes.getOrStart(key, () => dependencies.probe(tab.id, generation));
				if (!operation) { coverage.pending++; continue; }
				try {
					const result = await observeWithin(operation, Math.min(remaining, policy.probeTimeoutMs));
					if (!result.settled) {
						coverage.pending++; probeTimeoutCount = increment(probeTimeoutCount);
						dependencies.rememberCooldown(tab.id, 'pending', now + TRANSIENT_FAILURE_COOLDOWN_MS); continue;
					}
					if (generation !== dependencies.documentGeneration(tab.id) || result.value.outcome === 'stale') {
						coverage.stale++; staleCount = increment(staleCount);
						dependencies.rememberCooldown(tab.id, 'stale', now + TRANSIENT_FAILURE_COOLDOWN_MS);
					} else if (result.value.outcome === 'denied') {
						coverage.denied++; deniedCount = increment(deniedCount);
						dependencies.rememberCooldown(tab.id, 'denied', now + DENIED_COOLDOWN_MS);
					} else if (result.value.outcome === 'unknown') {
						coverage.unknown++; unknownCount = increment(unknownCount);
						dependencies.rememberCooldown(tab.id, 'unknown', now + TRANSIENT_FAILURE_COOLDOWN_MS);
					} else {
						coverage.examined++;
						dependencies.forgetCooldown(tab.id);
						if (result.value.outcome === 'found') {
							visible.add(tab.id);
							dependencies.rememberFact(tab.id, result.value.documentId, 'found', 'probe');
						} else {
							dependencies.rememberFact(tab.id, result.value.documentId, 'no-media', 'probe');
						}
					}
				} catch {
					coverage.unknown++; unknownCount = increment(unknownCount);
					dependencies.rememberCooldown(tab.id, 'unknown', now + TRANSIENT_FAILURE_COOLDOWN_MS);
				}
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

	// Non-blocking inventory projection: facts + seeds + durable cooldowns only.
	// Unknown tabs stay pending and are converged by the background sweep, so a
	// popup read never waits for chrome.scripting probes.
	const readNow = async (now = Date.now()): Promise<MediaTabInventory> => {
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
		const probeableTabs = allTabs.filter(probeableNow);
		for (const tab of allTabs) {
			if (probeableNow(tab) || tab.id === undefined) continue;
			visible.delete(tab.id);
		}
		const coverage = { total: probeableTabs.length, examined: 0, pending: 0, denied: 0, stale: 0, unknown: 0 };
		for (const tab of probeableTabs) {
			if (visible.has(tab.id)) { coverage.examined++; continue; }
			const fact = dependencies.readFact(tab.id);
			if (fact && dependencies.isFactCurrent(fact)) {
				if (fact.outcome === 'found') visible.add(tab.id);
				coverage.examined++;
				continue;
			}
			const cooldown = dependencies.readCooldown(tab.id);
			if (cooldown && now < cooldown.until) {
				if (cooldown.outcome === 'denied') coverage.total--;
				else coverage[cooldown.outcome]++;
				continue;
			}
			coverage.pending++;
		}
		const accounted = coverage.examined + coverage.pending + coverage.denied + coverage.stale + coverage.unknown;
		if (accounted < coverage.total) coverage.pending += coverage.total - accounted;
		const failed = coverage.pending + coverage.denied + coverage.stale + coverage.unknown;
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
	discover.readNow = readNow;
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
