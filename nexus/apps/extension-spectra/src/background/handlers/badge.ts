// goal: projects per-tab extension usage plus acknowledged audio state onto the Action badge
// rule: untouched page-native 0-100 observations stay hidden; every successful extension action is sticky until tab close

import { badgeState, BADGE_COLORS, type BadgeInfo } from '../state';
import { isTabExists } from '../helpers';
import {
	audioSessionMatchesControlDocument,
	compileEffectiveVolume,
	isActiveCaptureLifecycle,
	resolveVolumeTone,
	type AudioSessionSnapshot,
	type ControlSessionPatch,
	type ControlSnapshot,
	type VolumeTone,
} from '@nexus/contracts';
import { hasBadgeUsage, markBadgeUsed } from '../badge-usage';

type BadgeAuthority = 'control' | 'session';
type BadgeIdentity = Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'>;
type BadgeFacts = Pick<BadgeInfo, 'volume' | 'muted' | 'enabled' | 'isCapture' | 'tone' | 'userInteracted'>;

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

// eff: paints the decision that is current when the Action API is reached
interface StagedVolumeEntry {
	volume: number;
	tone: VolumeTone;
	/** Monotonic order of the staged inputs, so "newer than" needs no clock. */
	stamp: number;
	at: number;
}
const stagedVolumes = new Map<number, StagedVolumeEntry>();
let stagedStamp = 0;
// A gesture stage is authoritative until the projection that settles it lands.
// The wall clock only bounds a stage whose acknowledgement never arrives.
const STAGED_GRACE_MS = 600;

export function resetStagedVolumesForTests(): void {
	stagedVolumes.clear();
	stagedStamp = 0;
}

/** The stage counter a caller observed before it started awaiting. */
function observeStage(): number {
	return stagedStamp;
}

function stagedOverrides(
	tabId: number,
	observedStamp: number,
	projectedVolume: number,
): StagedVolumeEntry | null {
	const staged = stagedVolumes.get(tabId);
	if (!staged) return null;
	// A gesture that arrived while this projection was being resolved is newer
	// than the facts it was built from, whatever the projection says.
	if (staged.stamp > observedStamp) return staged;
	const settling = staged.volume !== projectedVolume
		&& Date.now() - staged.at < STAGED_GRACE_MS;
	return settling ? staged : null;
}

async function paintBadge(tabId: number): Promise<void> {
	if (!await isTabExists(tabId)) {
		badgeState.delete(tabId);
		return;
	}
	const decision = badgeState.get(tabId);
	const action = chrome.action;
	if (!decision) {
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
		// Chrome Action rejects when the tab no longer exists or window is retiring
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
	// Read the stage order before the first await: a gesture that lands while
	// this projection is still resolving is newer than every fact below it.
	const observedStage = observeStage();
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
			tone: 'muted',
			userInteracted: false,
		}, 'control', snapshot);
		return paintBadge(snapshot.tabId);
	}

	const projectedVolume = compileEffectiveVolume(projection.volumeBase, projection.boost);
	const staged = stagedOverrides(snapshot.tabId, observedStage, projectedVolume);
	const muted = projection.mediaMuted === true;
	const enabled = projection.audioEnabled ?? true;
	const volume = staged?.volume ?? projectedVolume;
	const tone = resolveVolumeTone({
		volume,
		muted,
		enabled,
		captureActive: isCaptureActive,
	});

	recordBadgeDecision(snapshot.tabId, {
		volume,
		muted,
		enabled,
		isCapture: isCaptureActive,
		// The gesture already published this tone; keeping it means the badge only
		// changes when the *route* changes, never one acknowledgement later.
		tone: staged?.tone ?? tone,
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
	const captureActive = isActiveCaptureLifecycle(snapshot);
	recordBadgeDecision(snapshot.tabId, {
		volume: previous.volume,
		muted: previous.muted,
		enabled: previous.enabled,
		isCapture: captureActive,
		tone: resolveVolumeTone({
			volume: previous.volume,
			muted: previous.muted,
			enabled: previous.enabled,
			captureActive,
		}),
		userInteracted: true,
	}, 'control', snapshot);
	return paintBadge(snapshot.tabId);
}

/**
 * Instant synchronous feedback for live gestures, before full pipeline
 * settlement.
 *
 * The card publishes the tone it is painting in the same message, so the badge
 * never has to infer a route from a number: at 100 and at 110, on a hijacked
 * page and a page that amplifies natively, the badge and the slider are the same
 * colour in the same frame.
 */
export function updateBadgeStagedVolume(
	tabId: number,
	effectiveVolume: number,
	tone?: VolumeTone,
	identity?: Pick<ControlSnapshot, 'documentId' | 'origin' | 'generation'> | null,
): void {
	if (!Number.isFinite(effectiveVolume) || effectiveVolume < 0) return;
	const current = badgeState.get(tabId);
	const stagedTone = tone ?? current?.tone ?? resolveVolumeTone({
		volume: effectiveVolume,
		muted: current?.muted ?? false,
		enabled: current?.enabled ?? true,
		captureActive: current?.isCapture ?? false,
	});
	stagedStamp += 1;
	stagedVolumes.set(tabId, {
		volume: effectiveVolume,
		tone: stagedTone,
		stamp: stagedStamp,
		at: Date.now(),
	});
	// The mute fact has to agree with the tone the card just published, or the
	// next session report would recompute `native` from a stale `muted: false`
	// and paint the number back over the M the user is looking at. A zero volume
	// is silence, not a mute, and a disabled processor states nothing at all, so
	// those two keep whatever the projection last acknowledged.
	const enabled = current?.enabled ?? true;
	const muted = enabled
		? stagedTone === 'muted' && effectiveVolume > 0
		: current?.muted ?? false;
	recordBadgeDecision(tabId, {
		volume: effectiveVolume,
		muted,
		enabled,
		// A predicted violet is a *tone*, not a Capture fact: only the ACK may
		// claim the processor is running.
		isCapture: current?.isCapture ?? false,
		tone: stagedTone,
		userInteracted: true,
	}, current?.authority ?? 'control', {
		documentId: identity?.documentId ?? current?.documentId ?? '',
		origin: identity?.origin ?? current?.origin ?? '',
		generation: identity?.generation ?? current?.generation ?? 0,
	});
	void markBadgeUsed(tabId);
	void paintBadge(tabId);
}
