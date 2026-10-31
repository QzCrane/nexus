// goal: projects per-tab extension usage plus acknowledged audio state onto the Action badge
// rule: untouched page-native 0-100 observations stay hidden; every successful extension action is sticky until tab close

import { badgeState, BADGE_COLORS, type BadgeInfo } from '../state';
import { isTabExists } from '../helpers';
import {
	audioSessionMatchesControlDocument,
	compileEffectiveVolume,
	isActiveCaptureLifecycle,
	resolveAudioVolumeState,
	type AudioSessionSnapshot,
	type ControlSessionPatch,
	type ControlSnapshot,
} from '@nexus/contracts';
import { hasBadgeUsage, markBadgeUsed } from '../badge-usage';

type BadgeAuthority = 'control' | 'session';
type BadgeIdentity = Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'>;
type BadgeFacts = Pick<BadgeInfo, 'volume' | 'muted' | 'enabled' | 'isCapture' | 'userInteracted'>;

// A decision and its paint are two different things. The decision is recorded
// synchronously; the paint is queued behind whatever the Action API is doing.
// Keeping both in one function is what made the badge lie: a session report read
// `previous` before an await, the user's unmute ACK landed during that await,
// and the report then painted its own captured mute back over the fresh value.
// A tab that is not muted keeps showing "M" for the rest of its life that way.
function presentBadge(facts: BadgeFacts): { text: string; color: string } {
	const volumeState = resolveAudioVolumeState({
		volume: facts.volume,
		muted: facts.muted,
		actualMode: facts.isCapture ? 'capture' : 'bypass',
		phase: facts.isCapture ? 'active' : 'idle',
	});
	if (!facts.enabled) return { text: String(facts.volume), color: BADGE_COLORS.DISABLED };
	if (volumeState === 'silent') return { text: 'M', color: BADGE_COLORS.MUTED };
	return {
		text: String(facts.volume),
		color: volumeState === 'capture' ? BADGE_COLORS.CAPTURE : BADGE_COLORS.NATIVE,
	};
}

// post: this decision is visible to every concurrent reader before any await resumes
function recordBadgeDecision(
	tabId: number,
	facts: BadgeFacts,
	authority: BadgeAuthority,
	identity: BadgeIdentity | null = null,
): void {
	if (!facts.userInteracted) {
		badgeState.delete(tabId);
		return;
	}
	badgeState.set(tabId, {
		volume: facts.volume,
		muted: facts.muted,
		enabled: facts.enabled,
		isCapture: facts.isCapture,
		userInteracted: true,
		authority,
		text: presentBadge(facts).text,
		documentId: identity?.documentId ?? null,
		origin: identity?.origin ?? null,
		generation: identity?.generation ?? null,
	});
}

// eff: paints the decision that is current when the Action API is reached
async function paintBadge(tabId: number): Promise<void> {
	if (!await isTabExists(tabId)) {
		badgeState.delete(tabId);
		return;
	}
	// Read after the await, never before it: a decision recorded while this paint
	// was queued is newer than the one that scheduled it, so the visible glyph
	// must follow the newest fact instead of the one that arrived first.
	const decision = badgeState.get(tabId);
	const action = chrome.action;
	if (!decision) {
		// Badge rendering is a best-effort projection of acknowledged audio state.
		// A missing/unavailable Action API must never turn a successful processor
		// transition into a failed Capture operation.
		await action?.setBadgeText?.({ tabId, text: '' })?.catch(() => undefined);
		return;
	}
	const { text, color } = presentBadge(decision);
	try {
		await Promise.all([
			action.setBadgeText({ tabId, text }),
			action.setBadgeBackgroundColor({ tabId, color }),
			action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE }),
		]);
	} catch {
		// Only the decision this paint rendered may be invalidated: a newer one
		// recorded meanwhile is still owed a paint of its own.
		if (badgeState.get(tabId) === decision) badgeState.delete(tabId);
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
	if (await hasBadgeUsage(tabId)) await markBadgeUsedForTab(tabId);
}

export async function updateBadgeFromControlProjection(
	snapshot: Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin' | 'generation'>,
	projection: ControlSessionPatch,
	isCaptureActive: boolean,
	userInteracted: boolean,
): Promise<void> {
	const used = await resolveStickyUsage(snapshot.tabId, userInteracted);
	const stickyInteraction = used || badgeState.get(snapshot.tabId)?.userInteracted === true;
	if (typeof projection.volumeBase !== 'number' || typeof projection.boost !== 'number') {
		if (stickyInteraction) {
			await markBadgeUsedForTab(snapshot.tabId);
			return;
		}
		recordBadgeDecision(snapshot.tabId, {
			volume: 0,
			muted: false,
			enabled: true,
			isCapture: false,
			userInteracted: false,
		}, 'control', snapshot);
		return paintBadge(snapshot.tabId);
	}
	recordBadgeDecision(snapshot.tabId, {
		volume: compileEffectiveVolume(projection.volumeBase, projection.boost),
		muted: projection.mediaMuted === true,
		enabled: projection.audioEnabled ?? true,
		isCapture: isCaptureActive,
		userInteracted: stickyInteraction,
	}, 'control', snapshot);
	return paintBadge(snapshot.tabId);
}

export async function updateBadgeFromSession(
	snapshot: AudioSessionSnapshot,
	userInteracted: boolean,
): Promise<void> {
	const used = await resolveStickyUsage(snapshot.tabId, userInteracted);
	// Read the current decision *after* that await. A control ACK may have landed
	// while this session report was still being resolved, and its facts are newer
	// than any `previous` captured before it: reusing the captured mute here is
	// exactly the stale write this function has to avoid.
	const previous = badgeState.get(snapshot.tabId);
	const stickyInteraction = previous?.userInteracted === true || used;
	const keepControlActual = previous?.authority === 'control'
		&& audioSessionMatchesControlDocument(snapshot, {
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
	recordBadgeDecision(snapshot.tabId, {
		volume: previous.volume,
		muted: previous.muted,
		enabled: previous.enabled,
		isCapture: isActiveCaptureLifecycle(snapshot),
		userInteracted: true,
	}, 'control', snapshot);
	return paintBadge(snapshot.tabId);
}

/**
 * Instant synchronous volume feedback for live gestures before full pipeline settlement.
 * Keeps the toolbar Action badge text completely in sync with the Popup volume slider,
 * without waiting for asynchronous storage round-trips or coalesce timeouts.
 */
export function updateBadgeStagedVolume(
	tabId: number,
	effectiveVolume: number,
	identity?: Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'> | null,
): void {
	if (!Number.isFinite(effectiveVolume) || effectiveVolume < 0) return;
	const current = badgeState.get(tabId);
	recordBadgeDecision(tabId, {
		volume: effectiveVolume,
		muted: current?.muted ?? false,
		enabled: current?.enabled ?? true,
		isCapture: current?.isCapture ?? false,
		userInteracted: true,
	}, current?.authority ?? 'control', {
		documentId: identity?.documentId ?? current?.documentId ?? '',
		origin: identity?.origin ?? current?.origin ?? '',
		generation: identity?.generation ?? current?.generation ?? 0,
	});
	void markBadgeUsed(tabId);
	void paintBadge(tabId);
}

