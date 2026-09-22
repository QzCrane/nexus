// goal: handles messages for retrieving and updating audio configurations with session/preset separation

import {
	SPECTRA_PROTOCOL_VERSION,
	normalizeHostname,
	type AudioConfig,
	type AudioSitePolicy,
	type AudioSessionSnapshot,
	type TabSessionIdentity,
	type VisualizerBatchPayload,
} from '@nexus/contracts';
import {
	audioConfigToControlSessionPatch,
	controlSessionPatchToAudioConfig,
} from '@nexus/kernel';
import { storage, captureStates } from '../state';
import {
	flushAudioSessions,
	getAudioSession,
	identityFromSender,
	updateAudioSession,
} from '../audio-session-store';
import { sendOffscreenMessageIfPresent } from '../offscreen-coordinator';
import { settingsRepository } from '../settings-repository';
import { scheduleMediaRouteProjection } from '../settings-projection';
import { updateBadgeFromSession } from './badge';
import { swLog } from '../../shared/logger';
import { sendSpectraTabRequest } from '../spectra-tab-client';
import { forEachBounded } from '../bounded-fanout';
import {
	isBackgroundRequestEnvelope,
	rpcFailure,
	rpcSuccess,
RPC_INVALID_REQUEST} from '../background-rpc';
import {
	advanceVisualizerSubscriberLeases,
	nextVisualizerSubscriberExpiry,
	planVisualizerSubscriberLease,
	removeVisualizerTab,
	visualizerSubscriberUnion,
	type VisualizerSubscriberLeases,
} from '../visualizer-subscriber-registry';
import {
	abandonPopupVisualizerSource,
	acquirePopupVisualizerSource,
	isExtensionPopupSender,
	releasePopupVisualizerSource,
	type PopupVisualizerSourceLease,
} from '../control-coordinator';
const PROTO_AUDIO_SESSION_CURRENT = 'spectra.audio.session.current' as const;
const PROTO_AUDIO_SESSION_PUBLISH = 'spectra.audio.session.publish' as const;
const PROTO_AUDIO_SESSION_FLUSH = 'spectra.audio.session.flush' as const;
const PROTO_AUDIO_SESSION_GET = 'spectra.audio.session.get' as const;
const PROTO_AUDIO_ROUTE_RECORD = 'spectra.audio.route.record' as const;
const PROTO_AUDIO_ROUTE_GET = 'spectra.audio.route.get' as const;
const PROTO_AUDIO_PAGE_SCALE_RECORD = 'spectra.audio.page-scale.record' as const;
const PROTO_AUDIO_VISUALIZER_BATCH = 'spectra.audio.visualizer.batch' as const;
const PROTO_AUDIO_CONFIG_GET = 'spectra.audio.config.get' as const;
const PROTO_AUDIO_CONFIG_SET = 'spectra.audio.config.set' as const;
const PROTO_AUDIO_POLICY_GET = 'spectra.audio.policy.get' as const;

const sessionIdentityFromSender = identityFromSender;

function controlSessionIdentityFromSender(sender: chrome.runtime.MessageSender) {
	const identity = sessionIdentityFromSender(sender);
	const resourceUrl = sender.url ?? sender.tab?.url;
	if (!identity || !resourceUrl) return null;
	try {
		return storage.tabSession.identity(identity.tabId, identity.documentId, resourceUrl);
	} catch {
		return null;
	}
}

async function resolveAudioPolicyForSender(sender: chrome.runtime.MessageSender): Promise<AudioSitePolicy> {
	const tabId = sender.tab?.id;
	const identity = controlSessionIdentityFromSender(sender);
	const resourceUrl = await requireCurrentSenderResourceUrl(sender);
	const domain = normalizeHostname(resourceUrl) ?? '';
	let config: AudioConfig | null = null;
	if (tabId && identity) {
		try {
			const session = await storage.tabSession.get(tabId, identity);
			if (session) config = controlSessionPatchToAudioConfig(session);
		} catch (error) {
			swLog.warn(`[Audio] Failed to restore tab ${tabId} session config; using settings fallback`, error);
		}
	}
	const [fallbackConfig, mediaRoute] = await Promise.all([
		config ? Promise.resolve(config) : settingsRepository.resolveAudioConfig(domain),
		settingsRepository.resolveMediaRouteDecisionForUrl(resourceUrl)
			.then((decision) => decision.mediaRoute),
	]);
	return { config: fallbackConfig, mediaRoute };
}

function requireSenderHostname(sender: chrome.runtime.MessageSender): string {
	const hostname = normalizeHostname(sender.url ?? sender.tab?.url ?? '');
	if (!hostname) throw new Error('Audio route requires a valid content-document hostname');
	return hostname;
}

async function requireCurrentSenderResourceUrl(sender: chrome.runtime.MessageSender): Promise<string> {
	const tabId = sender.tab?.id;
	const documentId = sender.documentId;
	if (!tabId || sender.frameId !== 0 || !documentId) {
		throw new Error('Audio route requires a top-level document identity');
	}
	const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0, documentId });
	if (!frame?.url || frame.documentId !== documentId || !normalizeHostname(frame.url)) {
		throw new Error('Audio route sender is no longer the current top-level document');
	}
	return frame.url;
}

function senderMatchesEnvelope(
	sender: chrome.runtime.MessageSender,
	message: { tabId?: number; documentId?: string },
): boolean {
	const identity = sessionIdentityFromSender(sender);
	if (!identity) return message.documentId === undefined;
	return (message.tabId === undefined || message.tabId === identity.tabId)
		&& (message.documentId === undefined || message.documentId === identity.documentId);
}

function currentContentIdentityFromSender(
	sender: chrome.runtime.MessageSender,
): TabSessionIdentity | null {
	// session.current is v2-only and must identify one concrete content document.
	// Popup/offscreen callers have no tab, while pre-documentId senders cannot
	// safely distinguish a navigation boundary.
	if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.documentId || !sender.url) {
		return null;
	}
	const identity = sessionIdentityFromSender(sender);
	return identity?.documentId === sender.documentId ? identity : null;
}

function snapshotMatchesIdentity(
	snapshot: AudioSessionSnapshot,
	identity: TabSessionIdentity,
): boolean {
	return snapshot.tabId === identity.tabId
		&& snapshot.documentId === identity.documentId
		&& snapshot.origin === identity.origin;
}

function normalizeVisualizerFrame(value: unknown): number[] | null {
	if (value instanceof ArrayBuffer) value = Array.from(new Uint8Array(value));
	if (!Array.isArray(value) || value.length > 4096) return null;
	if (!value.every((sample) => Number.isInteger(sample) && sample >= 0 && sample <= 255)) return null;
	return value as number[];
}

let subscribedCaptureKey: string | null = null;
const visualizerSubscribers: VisualizerSubscriberLeases = new Map();
const visualizerSourceOwners = new Map<string, PopupVisualizerSourceLease>();
let visualizerExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let visualizerExpiryAt: number | null = null;
let visualizerQueue: Promise<void> = Promise.resolve();
let visualizerSourceRetryTimer: ReturnType<typeof setTimeout> | null = null;
let visualizerSourceRetryDelay = 500;

function enqueueVisualizerOperation<T>(operation: () => Promise<T>): Promise<T> {
	const result = visualizerQueue.then(operation, operation);
	// The queue itself is a tail, not the result observed by a caller. Keeping
	// the tail fulfilled means one failed reconciliation cannot poison every
	// later popup heartbeat or tab lifecycle transition.
	visualizerQueue = result.then(() => undefined, () => undefined);
	return result;
}

async function updateVisualizerSubscriptions(
	captureTabIds: number[],
): Promise<void> {
	const captureKey = [...captureTabIds].sort((left, right) => left - right).join(',');
	if (captureKey !== subscribedCaptureKey) {
		const response = await sendOffscreenMessageIfPresent({
			type: 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS',
			tabIds: captureTabIds,
		}).catch(() => null);
		if (captureTabIds.length > 0 && (!response
			|| [...response.subscribedTabIds].sort((left, right) => left - right).join(',') !== captureKey)) {
			// Preserve the last acknowledged key so the next heartbeat retries the
			// offscreen reconciliation.
			return;
		}
		subscribedCaptureKey = captureKey;
	}
}

function replaceVisualizerSubscribers(candidate: VisualizerSubscriberLeases): void {
	visualizerSubscribers.clear();
	for (const [subscriberId, subscriber] of candidate) {
		visualizerSubscribers.set(subscriberId, subscriber);
	}
}

async function reconcileVisualizerSourceOwners(
	candidate: VisualizerSubscriberLeases,
): Promise<void> {
	const desired = new Map<string, number>();
	for (const [subscriberId, lease] of candidate) {
		if (lease.state === 'active' && lease.captureTabId !== null) {
			desired.set(subscriberId, lease.captureTabId);
		}
	}

	for (const [subscriberId, owner] of [...visualizerSourceOwners]) {
		const desiredTabId = desired.get(subscriberId);
		if (desiredTabId === owner.tabId && owner.actualMode !== null) continue;
		if (!await releasePopupVisualizerSource(owner)) continue;
		visualizerSourceOwners.delete(subscriberId);
	}

	for (const [subscriberId, tabId] of desired) {
		if (visualizerSourceOwners.has(subscriberId)) continue;
		const acquisition = await acquirePopupVisualizerSource(tabId, subscriberId);
		visualizerSourceOwners.set(subscriberId, acquisition.lease);
		if (!acquisition.active) {
			// The enable request may have committed before an ACK was lost. Keep the
			// pending owner reachable and schedule an idempotent release before the
			// Popup's backoff admits another acquisition.
			scheduleVisualizerSourceOwnerRetry();
			throw new Error(acquisition.errorMessage ?? 'Visualizer Capture is unavailable');
		}
	}
}

function visualizerSourceOwnerNeedsRetry(): boolean {
	for (const [subscriberId, owner] of visualizerSourceOwners) {
		const subscriber = visualizerSubscribers.get(subscriberId);
		if (subscriber?.state !== 'active'
			|| subscriber.captureTabId !== owner.tabId
			|| owner.actualMode === null) return true;
	}
	return false;
}

function scheduleVisualizerSourceOwnerRetry(): void {
	if (!visualizerSourceOwnerNeedsRetry()) {
		if (visualizerSourceRetryTimer) clearTimeout(visualizerSourceRetryTimer);
		visualizerSourceRetryTimer = null;
		visualizerSourceRetryDelay = 500;
		return;
	}
	if (visualizerSourceRetryTimer) return;
	const delay = visualizerSourceRetryDelay;
	visualizerSourceRetryDelay = Math.min(5_000, delay * 2);
	visualizerSourceRetryTimer = setTimeout(() => {
		visualizerSourceRetryTimer = null;
		void enqueueVisualizerOperation(
			() => reconcileVisualizerSourceOwners(visualizerSubscribers),
		).catch((error: unknown) => {
			swLog.warn('[Audio] Visualizer source reconciliation retry failed', error);
		}).finally(scheduleVisualizerSourceOwnerRetry);
	}, delay);
}

function scheduleVisualizerLeaseExpiry(): void {
	const next = nextVisualizerSubscriberExpiry(visualizerSubscribers);
	if (next === null) {
		if (visualizerExpiryTimer) clearTimeout(visualizerExpiryTimer);
		visualizerExpiryTimer = null;
		visualizerExpiryAt = null;
		return;
	}
	// Keeping an already-earlier timer avoids a clear/set pair on every 15 Hz
	// heartbeat. At most one timer exists, and it wakes no more than once per TTL.
	if (visualizerExpiryTimer && visualizerExpiryAt !== null && visualizerExpiryAt <= next) return;
	if (visualizerExpiryTimer) clearTimeout(visualizerExpiryTimer);
	visualizerExpiryAt = next;
	visualizerExpiryTimer = setTimeout(() => {
		visualizerExpiryTimer = null;
		visualizerExpiryAt = null;
		void enqueueVisualizerOperation(async () => {
			const candidate = advanceVisualizerSubscriberLeases(visualizerSubscribers, Date.now());
			if (candidate === visualizerSubscribers) {
				scheduleVisualizerLeaseExpiry();
				return undefined;
			}
			await reconcileVisualizerSourceOwners(candidate);
			const union = visualizerSubscriberUnion(candidate);
			await updateVisualizerSubscriptions(
				union.filter((tabId) => captureStates.get(tabId) === true),
			);
			replaceVisualizerSubscribers(candidate);
			scheduleVisualizerSourceOwnerRetry();
			scheduleVisualizerLeaseExpiry();
		}).catch(() => {
			// A failed release does not revive the consumer. The next real request
			// reconciles the desired union, while the bounded tombstone remains.
			const candidate = advanceVisualizerSubscriberLeases(visualizerSubscribers, Date.now());
			replaceVisualizerSubscribers(candidate);
			scheduleVisualizerSourceOwnerRetry();
			scheduleVisualizerLeaseExpiry();
		});
	}, Math.max(0, next - Date.now()));
}

async function getVisualizerBatchNow(payload: VisualizerBatchPayload): Promise<{
	subscriberId: string;
	generation: number;
	frames: Record<string, number[] | null>;
}> {
	const plan = planVisualizerSubscriberLease(visualizerSubscribers, payload, Date.now());
	if (!plan.accepted && plan.candidate === visualizerSubscribers) {
		return {
			subscriberId: payload.subscriberId,
			generation: plan.responseGeneration,
			frames: {},
		};
	}
	const candidateSubscribers = plan.candidate;
	await reconcileVisualizerSourceOwners(candidateSubscribers);
	const unionTabIds = visualizerSubscriberUnion(candidateSubscribers);
	const unionCaptureTabIds = unionTabIds.filter((tabId) => captureStates.get(tabId) === true);
	await updateVisualizerSubscriptions(unionCaptureTabIds);
	replaceVisualizerSubscribers(candidateSubscribers);
	scheduleVisualizerSourceOwnerRetry();
	scheduleVisualizerLeaseExpiry();
	if (!plan.accepted) {
		return {
			subscriberId: payload.subscriberId,
			generation: plan.responseGeneration,
			frames: {},
		};
	}

	const { tabIds } = payload;
	const frames: Record<string, number[] | null> = Object.fromEntries(
		tabIds.map((tabId) => [String(tabId), null]),
	);
	const captureTabIds = tabIds.filter((tabId) => captureStates.get(tabId) === true);
	const pageTabIds = tabIds.filter((tabId) => captureStates.get(tabId) !== true);
	if (captureTabIds.length > 0) {
		const result = await sendOffscreenMessageIfPresent({
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: captureTabIds,
		}).catch(() => undefined);
		for (const tabId of captureTabIds) {
			frames[String(tabId)] = normalizeVisualizerFrame(result?.frames?.[String(tabId)]);
		}
	}
	await forEachBounded(pageTabIds, 8, async (tabId) => {
		const response = await sendSpectraTabRequest(
			tabId,
			'spectra.audio.visualizer.get',
			{},
		).catch(() => null);
		frames[String(tabId)] = normalizeVisualizerFrame(
			response?.ok ? response.data.buffer : null,
		);
	});

	return { subscriberId: payload.subscriberId, generation: payload.generation, frames };
}

function getVisualizerBatch(payload: VisualizerBatchPayload): Promise<{
	subscriberId: string;
	generation: number;
	frames: Record<string, number[] | null>;
}> {
	return enqueueVisualizerOperation(() => getVisualizerBatchNow(payload));
}

function releaseDisconnectedVisualizerSubscriber(subscriberId: string): void {
	void enqueueVisualizerOperation(async () => {
		// Each Popup uses a random page-lifetime id. A maximal tombstone makes a
		// delayed unload batch unable to resurrect a disconnected subscriber even
		// if the Port closed before its first request reached the worker.
		const plan = planVisualizerSubscriberLease(visualizerSubscribers, {
			subscriberId,
			generation: Number.MAX_SAFE_INTEGER,
			tabIds: [],
			captureTabId: null,
		}, Date.now());
		const candidate = plan.candidate;
		await reconcileVisualizerSourceOwners(candidate);
		const union = visualizerSubscriberUnion(candidate);
		await updateVisualizerSubscriptions(
			union.filter((tabId) => captureStates.get(tabId) === true),
		).catch(() => false);
		replaceVisualizerSubscribers(candidate);
		scheduleVisualizerSourceOwnerRetry();
		scheduleVisualizerLeaseExpiry();
	}).catch((error: unknown) => {
		swLog.warn('[Audio] Visualizer subscriber disconnect reconciliation failed', error);
	});
}

export function handleVisualizerTabRemoved(tabId: number): Promise<void> {
	return enqueueVisualizerOperation(async () => {
		const candidate = removeVisualizerTab(visualizerSubscribers, tabId);
		for (const [subscriberId, owner] of [...visualizerSourceOwners]) {
			if (owner.tabId !== tabId) continue;
			abandonPopupVisualizerSource(owner);
			visualizerSourceOwners.delete(subscriberId);
		}
		if (candidate === visualizerSubscribers) return;
		replaceVisualizerSubscribers(candidate);
		scheduleVisualizerSourceOwnerRetry();
		const union = visualizerSubscriberUnion(candidate);
		await updateVisualizerSubscriptions(
			union.filter((candidateTabId) => captureStates.get(candidateTabId) === true),
		);
		scheduleVisualizerLeaseExpiry();
	});
}

export function invalidateVisualizerDocument(tabId: number): Promise<void> {
	return enqueueVisualizerOperation(async () => {
		for (const [subscriberId, owner] of [...visualizerSourceOwners]) {
			if (owner.tabId !== tabId) continue;
			abandonPopupVisualizerSource(owner);
			visualizerSourceOwners.delete(subscriberId);
		}
	});
}

export function registerAudioV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		const isBackgroundAudioType = candidate.type === PROTO_AUDIO_CONFIG_GET
			|| candidate.type === PROTO_AUDIO_POLICY_GET
			|| candidate.type === PROTO_AUDIO_ROUTE_GET
			|| candidate.type === PROTO_AUDIO_ROUTE_RECORD
			|| candidate.type === PROTO_AUDIO_PAGE_SCALE_RECORD
			|| candidate.type === PROTO_AUDIO_CONFIG_SET
			|| candidate.type === PROTO_AUDIO_SESSION_GET
			|| candidate.type === PROTO_AUDIO_SESSION_CURRENT
			|| candidate.type === PROTO_AUDIO_SESSION_PUBLISH
			|| candidate.type === PROTO_AUDIO_SESSION_FLUSH
			|| candidate.type === 'spectra.audio.visualizer.batch';
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| typeof candidate.type !== 'string'
			|| !isBackgroundAudioType) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Audio session RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed audio session request'));
			return false;
		}
		const currentIdentity = message.type === PROTO_AUDIO_SESSION_CURRENT
			? currentContentIdentityFromSender(sender)
			: null;
		if (message.type === PROTO_AUDIO_SESSION_CURRENT && !currentIdentity) {
			sendResponse(rpcFailure(
				'forbidden',
				'Current audio session requires an extension content-document sender',
			));
			return false;
		}
		if (!senderMatchesEnvelope(sender, message)) {
			sendResponse(rpcFailure('forbidden', 'Audio request identity does not match its sender'));
			return false;
		}
		const operation = async () => {
			if (message.type === PROTO_AUDIO_CONFIG_GET) {
				const identity = sessionIdentityFromSender(sender);
				if (!identity) throw new Error('Audio configuration requires a document identity');
				return (await resolveAudioPolicyForSender(sender)).config;
			}
			if (message.type === PROTO_AUDIO_POLICY_GET) {
				const identity = sessionIdentityFromSender(sender);
				if (!identity) throw new Error('Audio policy requires a document identity');
				return resolveAudioPolicyForSender(sender);
			}
			if (message.type === PROTO_AUDIO_ROUTE_GET) {
				if (!sessionIdentityFromSender(sender)) {
					throw new Error('Audio route requires a document identity');
				}
				return settingsRepository.resolveMediaRouteDecisionForUrl(
					await requireCurrentSenderResourceUrl(sender),
				);
			}
			if (message.type === PROTO_AUDIO_ROUTE_RECORD) {
				if (!sessionIdentityFromSender(sender)) {
					throw new Error('Audio route evidence requires a document identity');
				}
				const hostname = requireSenderHostname({
					...sender,
					url: await requireCurrentSenderResourceUrl(sender),
				});
				const result = await settingsRepository.markMediaRouteProbed(
					hostname,
					message.payload.route,
					{ force: message.payload.force === true },
				);
				const snapshot = await settingsRepository.getSnapshot();
				scheduleMediaRouteProjection(snapshot, hostname);
				return {
					mediaRoute: result.entry.route,
					source: result.entry.source,
				};
			}
			if (message.type === PROTO_AUDIO_PAGE_SCALE_RECORD) {
				if (!sessionIdentityFromSender(sender)) {
					throw new Error('Page-scale evidence requires a document identity');
				}
				await settingsRepository.recordPageNativeScale(
					requireSenderHostname(sender),
					message.payload.supported,
				);
				return { recorded: true as const };
			}
			if (message.type === PROTO_AUDIO_CONFIG_SET) {
				const identity = controlSessionIdentityFromSender(sender);
				if (!identity) throw new Error('Audio configuration requires a document identity');
				await storage.tabSession.merge(
					identity.tabId,
					audioConfigToControlSessionPatch(message.payload.config),
					identity,
				);
				return { saved: true as const };
			}
			if (message.type === PROTO_AUDIO_SESSION_GET) {
				return getAudioSession(message.payload.tabId);
			}
			if (message.type === PROTO_AUDIO_SESSION_CURRENT) {
				if (!currentIdentity) throw new Error('Current audio session identity was lost');
				const snapshot = await getAudioSession(currentIdentity.tabId);
				return snapshot && snapshotMatchesIdentity(snapshot, currentIdentity)
					? snapshot
					: null;
			}
			if (message.type === PROTO_AUDIO_SESSION_PUBLISH) {
				const identity = sessionIdentityFromSender(sender);
				if (!identity || message.generation === undefined) {
					throw new Error('Audio session publish requires a document identity and generation');
				}
				const snapshot = await updateAudioSession(identity, {
					config: message.payload.config,
					desiredMode: message.payload.desiredMode,
					actualMode: message.payload.actualMode,
					phase: message.payload.phase,
					generation: message.generation,
					error: message.payload.lastError,
				});
				await updateBadgeFromSession(snapshot, message.payload.userInteracted);
				return snapshot;
			}
			if (message.type === PROTO_AUDIO_SESSION_FLUSH) {
				const tabId = message.tabId ?? sender.tab?.id;
				if (!tabId) throw new Error('Audio session flush requires a tab identity');
				await Promise.all([
					storage.tabSession.flush(tabId),
					flushAudioSessions(tabId),
				]);
				return { flushed: true as const };
			}
			if (message.type !== PROTO_AUDIO_VISUALIZER_BATCH) {
				throw new Error('Unsupported audio session request');
			}
			if (message.payload.captureTabId !== null && !isExtensionPopupSender(sender)) {
				throw new Error('Visualizer Capture demand requires the extension Popup');
			}
			return getVisualizerBatch(message.payload);
		};
		void operation()
			.then((result) => sendResponse(rpcSuccess(result)))
			.catch((error) => sendResponse(rpcFailure(
				'audio_unavailable',
				error instanceof Error ? error.message : String(error),
				true,
			)));
		return true;
	});
}

// eff: registers the validated SPECTRA audio protocol and lifecycle listeners
export function registerAudioHandlers(): void {
	registerAudioV2Listener();
	chrome.runtime.onConnect.addListener((port) => {
		const prefix = 'spectra-visualizer:';
		if (port.sender?.id !== chrome.runtime.id
			|| port.sender.url !== chrome.runtime.getURL('popup.html')
			|| !port.name.startsWith(prefix)) return;
		const subscriberId = port.name.slice(prefix.length);
		if (!/^popup-[a-z0-9-]{1,100}$/iu.test(subscriberId)) return;
		port.onDisconnect.addListener(() => {
			releaseDisconnectedVisualizerSubscriber(subscriberId);
		});
	});
}

export const audioHandlerTestApi = {
	seedVisualizerSubscriber(
		subscriberId: string,
		generation: number,
		tabIds: number[],
	): void {
		const plan = planVisualizerSubscriberLease(visualizerSubscribers, {
			subscriberId,
			generation,
			tabIds,
			captureTabId: null,
		}, Date.now());
		replaceVisualizerSubscribers(plan.candidate);
		scheduleVisualizerLeaseExpiry();
	},
	reconcileVisualizerSubscriptions(
		captureTabIds: number[],
	): Promise<void> {
		return enqueueVisualizerOperation(() => updateVisualizerSubscriptions(captureTabIds));
	},
	handleVisualizerTabRemoved,
	async reset(): Promise<void> {
		await visualizerQueue.catch(() => undefined);
		if (visualizerExpiryTimer) clearTimeout(visualizerExpiryTimer);
		visualizerExpiryTimer = null;
		visualizerExpiryAt = null;
		if (visualizerSourceRetryTimer) clearTimeout(visualizerSourceRetryTimer);
		visualizerSourceRetryTimer = null;
		visualizerSourceRetryDelay = 500;
		subscribedCaptureKey = null;
		visualizerSubscribers.clear();
		for (const owner of visualizerSourceOwners.values()) {
			abandonPopupVisualizerSource(owner);
		}
		visualizerSourceOwners.clear();
		visualizerQueue = Promise.resolve();
	},
};
