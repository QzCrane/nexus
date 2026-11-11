// goal: projects per-tab extension usage plus acknowledged audio state onto the Action badge
// rule: untouched page-native 0-100 observations stay hidden; every successful extension action is sticky until tab close

import { badgeState, BADGE_COLORS, type BadgeInfo } from '../state';
import { isTabExists } from '../helpers';
import {
	audioSessionMatchesControlDocument,
	compileEffectiveVolume,
	createBoundedMap,
	isActiveCaptureLifecycle,
	resolveVolumeTone,
	type AudioSessionSnapshot,
	type ControlSessionPatch,
	type ControlSnapshot,
	type VolumeTone,
	type SpectraHotkeyPresentationToken,
} from '@nexus/contracts';
import { hasBadgeUsage, markBadgeUsed } from '../badge-usage';
import { getAudioSession, isAudioSessionIdentityInvalidated } from '../audio-session-store';

type BadgeAuthority = 'control' | 'session';
type BadgeIdentity = Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'>;
type BadgeFacts = Pick<BadgeInfo, 'volume' | 'muted' | 'enabled' | 'isCapture' | 'tone' | 'userInteracted'>;

// `revision` is the control-basis revision the optimistic presentation was
// staged from. Hotkeys pass their ControlSnapshot, so a page observation that
// lands at a newer revision can prove the presentation is already superseded.
export type BadgePresentationIdentity = Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin' | 'generation'>
	& { revision?: number };
interface PendingBadgePresentation {
	identity: BadgePresentationIdentity;
	token: SpectraHotkeyPresentationToken;
	volume: number;
	tone: VolumeTone;
}
const pendingPresentations = createBoundedMap<number, PendingBadgePresentation>({ cap: 512, ttlMs: 300_000 });

export async function stageBadgeVolumePresentation(
	identity: BadgePresentationIdentity,
	token: SpectraHotkeyPresentationToken,
	volume: number,
	tone: VolumeTone,
): Promise<void> {
	if (isAudioSessionIdentityInvalidated(identity)) return;
	const actual = badgeState.get(identity.tabId);
	if (actual?.documentId === identity.documentId && actual.origin === identity.origin
		&& actual.generation !== null && actual.generation > identity.generation) return;
	const current = pendingPresentations.get(identity.tabId);
	if (current?.token.owner === token.owner && current.token.revision >= token.revision) return;
	pendingPresentations.set(identity.tabId, { identity, token, volume, tone });
	await paintBadge(identity.tabId, true);
}

export async function settleBadgeVolumePresentation(
	identity: BadgePresentationIdentity,
	token: SpectraHotkeyPresentationToken,
): Promise<void> {
	const current = pendingPresentations.get(identity.tabId);
	if (!current || current.identity.documentId !== identity.documentId
		|| current.identity.origin !== identity.origin || current.identity.generation !== identity.generation
		|| current.token.owner !== token.owner || current.token.revision > token.revision) return;
	pendingPresentations.delete(identity.tabId);
	await paintBadge(identity.tabId, true);
}

// A decision and its paint are two different things. The decision is recorded
// synchronously; the paint is queued behind whatever the Action API is doing.
// Keeping both in one function is what made the badge lie: a session report read
// `previous` before an await, the user's unmute ACK landed during that await,
// and the report then painted its own captured mute back over the fresh value.
// A tab that is not muted keeps showing "M" for the rest of its life that way.
function presentBadge(facts: BadgeFacts): { text: string; color: string } {
	if (!facts.enabled) return { text: String(facts.volume), color: BADGE_COLORS.DISABLED };
	switch (facts.tone) {
		case 'muted': return { text: 'M', color: BADGE_COLORS.MUTED };
		case 'capture': return { text: String(facts.volume), color: BADGE_COLORS.CAPTURE };
		default: return { text: String(facts.volume), color: BADGE_COLORS.NATIVE };
	}
}

// post: this decision is visible to every concurrent reader before any await resumes
function recordBadgeDecision(
	tabId: number,
	facts: BadgeFacts,
	authority: BadgeAuthority,
	identity: BadgeIdentity | null = null,
): void {
	const pending = pendingPresentations.get(tabId);
	if (pending && identity && (pending.identity.documentId !== identity.documentId
		|| pending.identity.origin !== identity.origin || pending.identity.generation !== identity.generation)) {
		pendingPresentations.delete(tabId);
	}
	if (!facts.userInteracted) {
		badgeState.delete(tabId);
		return;
	}
	badgeState.set(tabId, {
		volume: facts.volume,
		muted: facts.muted,
		enabled: facts.enabled,
		isCapture: facts.isCapture,
		tone: facts.tone,
		userInteracted: true,
		authority,
		text: presentBadge(facts).text,
		documentId: identity?.documentId ?? null,
		origin: identity?.origin ?? null,
		generation: identity?.generation ?? null,
	});
}

interface PaintedBadge {
	text: string;
	color: string;
	documentId: string | null;
	generation: number | null;
}
// What the Action API was last asked to show, so a burst of identical
// projections costs one paint instead of one per sample. Keyed by the same
// identity the decision carries: Chrome clears a tab-scoped projection on full
// navigation, and a decision from another document must repaint even when the
// text and colour happen to match.
const paintedBadges = createBoundedMap<number, PaintedBadge>({ cap: 512, ttlMs: 300_000 });

/**
 * Forget what this tab is believed to show.
 *
 * Chrome owns the visible per-tab projection and clears it on its own schedule,
 * so anything that repaints after a browser-side reset has to declare that the
 * cache no longer describes the screen.
 */
export function invalidatePaintedBadge(tabId: number): void {
	paintedBadges.delete(tabId);
}

export function forgetBadgePresentation(tabId: number): void {
	const hadPendingPresentation = pendingPresentations.has(tabId);
	pendingPresentations.delete(tabId);
	badgeState.delete(tabId);
	paintedBadges.delete(tabId);
	appliedBadgeProjections.delete(tabId);
	if (hadPendingPresentation) void paintBadge(tabId, true);
}

/** Simulates a worker that never painted anything; tests only. */
export function resetPaintedBadgesForTests(): void {
	pendingPresentations.clear();
	paintedBadges.clear();
	appliedBadgeProjections.clear();
}

interface BadgeProjectionOrder {
	documentId: string | null;
	generation: number | null;
	revision: number;
}

/**
 * The newest projection this tab has already decided on.
 *
 * Two routes feed the badge — a control acknowledgement and a page-native
 * observation — and each one awaits storage before it decides. Their resolutions
 * therefore interleave out of order: an observation sampled before a speed ACK
 * could land after it and paint the old volume back. Revision is the only total
 * order the coordinator provides, so the badge remembers the last one it decided
 * on and drops anything strictly older. Audio-session reports change lifecycle
 * only, while the coordinator supplies current acknowledged volume facts.
 */
const appliedBadgeProjections = createBoundedMap<number, BadgeProjectionOrder>({
	cap: 512,
	ttlMs: 300_000,
});

function admitBadgeProjection(
	tabId: number,
	identity: BadgeIdentity,
	revision: number | undefined,
): boolean {
	if (revision === undefined) return true;
	const previous = appliedBadgeProjections.get(tabId);
	if (previous
		&& previous.documentId === identity.documentId
		&& previous.generation === identity.generation
		&& revision < previous.revision) return false;
	appliedBadgeProjections.set(tabId, {
		documentId: identity.documentId,
		generation: identity.generation,
		revision,
	});
	return true;
}

/**
 * True when an admitted projection already outranks a staged presentation.
 *
 * An optimistic presentation stands in for the gesture that produced it. A
 * projection decided at a newer revision for the same document is a later fact
 * than that gesture's basis, so it must be able to replace the presentation even
 * when the gesture's write never settles (a page that resets its own volume, a
 * retryable unmute rejection, a dead Popup Port). Without this the presentation
 * pinned the badge to its old number until settlement, the Popup, or the 5-minute
 * TTL — the reported "the badge only follows after I open the Popup or pause and
 * play once" symptom. Equal revisions are deliberately not superseded: a sample
 * read before the gesture must never overwrite its optimistic value.
 */
function isSupersededPresentation(tabId: number, pending: PendingBadgePresentation): boolean {
	const basis = pending.identity.revision;
	if (basis === undefined) return false;
	const applied = appliedBadgeProjections.get(tabId);
	return applied !== undefined
		&& applied.documentId === pending.identity.documentId
		&& applied.generation === pending.identity.generation
		&& applied.revision > basis;
}

async function paintBadge(tabId: number, admittedPresentation = false): Promise<void> {
	if (!admittedPresentation && !await isTabExists(tabId)) {
		badgeState.delete(tabId);
		invalidatePaintedBadge(tabId);
		return;
	}
	const actual = badgeState.get(tabId);
	const pending = pendingPresentations.get(tabId);
	const effectivePending = pending && isSupersededPresentation(tabId, pending) ? undefined : pending;
	if (pending && !effectivePending) pendingPresentations.delete(tabId);
	const decision = effectivePending ? {
		volume: effectivePending.volume, tone: effectivePending.tone, enabled: actual?.enabled ?? true,
		muted: effectivePending.tone === 'muted', isCapture: actual?.isCapture ?? false, userInteracted: false,
		documentId: effectivePending.identity.documentId, generation: effectivePending.identity.generation,
	} : actual;
	const action = chrome.action;
	if (!decision) {
		invalidatePaintedBadge(tabId);
		await action?.setBadgeText?.({ tabId, text: '' })?.catch(() => undefined);
		return;
	}
	const { text, color } = presentBadge(decision);
	const painted = paintedBadges.get(tabId);
	if (painted && painted.text === text && painted.color === color
		&& painted.documentId === decision.documentId
		&& painted.generation === decision.generation) {
		return;
	}
	try {
		await Promise.all([
			action.setBadgeText({ tabId, text }),
			action.setBadgeBackgroundColor({ tabId, color }),
			action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE }),
		]);
		if (badgeState.get(tabId) !== actual || pendingPresentations.get(tabId) !== effectivePending) return;
		paintedBadges.set(tabId, {
			text,
			color,
			documentId: decision.documentId,
			generation: decision.generation,
		});
	} catch {
		// Chrome Action rejects when the tab no longer exists or window is retiring
		invalidatePaintedBadge(tabId);
		if (badgeState.get(tabId) === actual) badgeState.delete(tabId);
	}
}

async function resolveStickyUsage(tabId: number, userInteracted: boolean | undefined): Promise<boolean> {
	return userInteracted ? markBadgeUsed(tabId) : hasBadgeUsage(tabId);
}

// post: successful plugin use remains sticky without inventing presentation.
// Rendering starts only after a complete acknowledged volume projection exists.
export async function markBadgeUsedForTab(tabId: number): Promise<void> {
	await markBadgeUsed(tabId);
}

// Chrome may clear the visible per-tab Action projection on navigation even
// though the monotonic usage fact remains valid. Restore only an existing fact;
// this function never turns a passive page observation into extension usage.
export async function restoreBadgeUsageForTab(tabId: number): Promise<void> {
	// Whatever Chrome is showing now is not what this map recorded.
	invalidatePaintedBadge(tabId);
	if (await hasBadgeUsage(tabId)) await markBadgeUsedForTab(tabId);
}

/**
 * True when this tab already shows an extension-authored projection.
 *
 * A page-native observation may refine a badge that is already visible, but it
 * may never be the reason one appears: an untouched tab keeps an empty badge no
 * matter what the page does with its own volume slider.
 *
 * "Already visible" is not the same fact as "this worker remembers painting
 * it". The tab-scoped Action projection and the persisted usage fact both
 * outlive a service-worker restart, so asking only the in-memory decision map
 * made every native volume gesture after a restart a silent no-op: the badge
 * stayed on whatever the dead worker had painted. Usage is the durable
 * evidence that this tab was ever touched, which is exactly the rule above.
 */
export async function isBadgeProjected(tabId: number): Promise<boolean> {
	return badgeState.has(tabId) || await hasBadgeUsage(tabId);
}

export async function updateBadgeFromControlProjection(
	snapshot: Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin' | 'generation'>,
	projection: ControlSessionPatch,
	isCaptureActive: boolean,
	userInteracted: boolean,
	revision?: number,
): Promise<void> {
	const used = await resolveStickyUsage(snapshot.tabId, userInteracted);
	// Usage lookup may outlive a processor transition. Resolve its current
	// lifecycle after that await instead of replaying the caller's old boolean.
	const currentSession = await getAudioSession(snapshot.tabId).catch(() => null);
	if (isAudioSessionIdentityInvalidated(snapshot)
		|| currentSession && !audioSessionMatchesControlDocument(currentSession, snapshot)) return;
	const captureActive = audioSessionMatchesControlDocument(currentSession, snapshot)
		? isActiveCaptureLifecycle(currentSession)
		: isCaptureActive;
	if (!admitBadgeProjection(snapshot.tabId, snapshot, revision)) return;
	const stickyInteraction = used || badgeState.get(snapshot.tabId)?.userInteracted === true;
	const volumeBase = projection.volumeBase;
	if (typeof volumeBase !== 'number') {
		if (stickyInteraction) {
			await markBadgeUsedForTab(snapshot.tabId);
			return;
		}
		recordBadgeDecision(snapshot.tabId, {
			volume: 0,
			muted: false,
			enabled: true,
			isCapture: false,
			tone: 'muted',
			userInteracted: false,
		}, 'control', snapshot);
		return paintBadge(snapshot.tabId);
	}

	// A missing boost is the neutral multiplier, not an absent volume: the page
	// reported a native 0-100 level and nothing acknowledged in this document has
	// amplified it. Requiring both made every page-native volume gesture look like
	// a projection with no volume at all, which is how the badge stopped
	// following the page.
	const boost = typeof projection.boost === 'number' ? projection.boost : 1;
	const volume = compileEffectiveVolume(volumeBase, boost);
	const muted = projection.mediaMuted === true;
	const enabled = projection.audioEnabled ?? true;
	const tone = resolveVolumeTone({
		volume,
		muted,
		enabled,
		captureActive,
	});
	recordBadgeDecision(snapshot.tabId, {
		volume,
		muted,
		enabled,
		isCapture: captureActive,
		tone,
		userInteracted: stickyInteraction,
	}, 'control', snapshot);
	return paintBadge(snapshot.tabId);
}
export async function updateBadgeFromSession(
	snapshot: AudioSessionSnapshot,
	userInteracted: boolean,
): Promise<void> {
	const used = await resolveStickyUsage(snapshot.tabId, userInteracted);
	// Audio and control generations have independent owners. Read the current
	// audio lifecycle from its store and retain the badge's control identity.
	const currentSession = await getAudioSession(snapshot.tabId).catch(() => null);
	if (!audioSessionMatchesControlDocument(currentSession, snapshot)) return;
	// Read the current decision *after* that await. A control ACK may have landed
	// while this session report was still being resolved, and its facts are newer
	// than any `previous` captured before it: reusing the captured mute here is
	// exactly the stale write this function has to avoid.
	const previous = badgeState.get(snapshot.tabId);
	const stickyInteraction = previous?.userInteracted === true || used;
	const keepControlActual = previous?.authority === 'control'
		&& audioSessionMatchesControlDocument(currentSession, {
			tabId: snapshot.tabId,
			documentId: previous.documentId ?? '',
			origin: previous.origin ?? '',
		});
	// AudioSessionSnapshot owns lifecycle only. Without a matching actual control
	// projection, hiding the badge is safer than publishing stale volume/color.
	if (!keepControlActual || !previous) {
		const documentChanged = previous?.documentId != null
			&& previous.documentId !== snapshot.documentId;
		badgeState.delete(snapshot.tabId);
		// Chrome retains the last per-tab Action projection across navigation and
		// worker suspension. Two different situations hide behind that:
		// - the projection belongs to another document: keeping its volume or M
		//   would claim something about this page that was never acknowledged here;
		// - a restarted worker has no identity at all: clearing would erase the last
		//   truthful ACK of the very document this session is re-establishing.
		// Only the second case preserves the visible badge.
		if (stickyInteraction && !documentChanged) return;
		return paintBadge(snapshot.tabId);
	}
	const captureActive = isActiveCaptureLifecycle(currentSession);
	const volume = previous.volume;
	const tone = resolveVolumeTone({
		volume,
		muted: previous.muted,
		enabled: previous.enabled,
		captureActive,
	});
	recordBadgeDecision(snapshot.tabId, {
		volume,
		muted: previous.muted,
		enabled: previous.enabled,
		isCapture: captureActive,
		tone,
		userInteracted: true,
	}, 'control', {
		documentId: previous.documentId ?? '',
		origin: previous.origin ?? '',
		generation: previous.generation ?? 0,
	});
	return paintBadge(snapshot.tabId);
}
