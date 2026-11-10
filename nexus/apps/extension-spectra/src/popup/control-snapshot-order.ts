// goal: owns the tab-scoped monotonic admission rule for every Popup projection of ControlSnapshot

import type { ControlSnapshot } from '@nexus/contracts';
import { compareMediaObservations, MEDIA_OBSERVATION_FIELDS } from '@nexus/contracts/ui-runtime';

/** Control and physical-observation clocks have distinct duties in one snapshot. */
export function reconcileControlMedia(current: ControlSnapshot | null, incoming: ControlSnapshot): ControlSnapshot {
	if (!current || current.tabId !== incoming.tabId || current.documentId !== incoming.documentId
		|| current.generation !== incoming.generation || !current.mediaObservation) return incoming;
	const physicalOrder = incoming.mediaObservation ? compareMediaObservations(incoming.mediaObservation, current.mediaObservation) : null;
	const fields = { ...incoming.fields };
	for (const field of MEDIA_OBSERVATION_FIELDS) {
		const next = fields[field];
		const prior = current.fields[field];
		const nextStamp = next?.mediaObservation ?? incoming.mediaObservation;
		const priorStamp = prior?.mediaObservation ?? current.mediaObservation;
		const fieldOrder = nextStamp ? compareMediaObservations(nextStamp, priorStamp) : null;
		if (physicalOrder === null || physicalOrder < 0 || fieldOrder === null || fieldOrder < 0) {
			if (prior) Object.assign(fields, { [field]: prior });
			else delete fields[field];
		}
	}
	const keepingCurrentMedia = physicalOrder === null || physicalOrder < 0;
	const reconciled: ControlSnapshot = { ...incoming, fields,
		...(keepingCurrentMedia
			? { activeMedia: current.activeMedia, activeVideo: current.activeVideo, mediaObservation: current.mediaObservation } : {}),
	};
	// `live` describes the media target, not the tab. When this projection keeps
	// the older target, it must keep that target's proof too: taking the incoming
	// flag would describe the media this projection just refused.
	if (keepingCurrentMedia) {
		if (current.live === undefined) delete reconciled.live;
		else reconciled.live = current.live;
		if (current.prospectiveBoostRoute === undefined) delete reconciled.prospectiveBoostRoute;
		else reconciled.prospectiveBoostRoute = current.prospectiveBoostRoute;
	}
	return reconciled;
}

export type ControlSnapshotAdmission =
	| 'accepted'
	| 'stale'
	| 'tab-conflict'
	| 'identity-conflict';

export function isControlClockStale(
	currentGeneration: number,
	currentRevision: number,
	incomingGeneration: number,
	incomingRevision: number,
): boolean {
	return incomingGeneration < currentGeneration
		|| incomingGeneration === currentGeneration && incomingRevision < currentRevision;
}

// Control generation is a tab-scoped lifecycle clock. A different document or
// origin may replace the current identity only on a strictly newer generation;
// revision is monotonic inside one generation. Keeping this rule in one pure
// owner prevents Card and SidePanel from disagreeing about delayed navigation
// events.
export function classifyControlSnapshot(
	current: ControlSnapshot | null,
	incoming: ControlSnapshot,
): ControlSnapshotAdmission {
	if (!current) return 'accepted';
	if (incoming.tabId !== current.tabId) return 'tab-conflict';
	if (isControlClockStale(
		current.generation,
		current.revision,
		incoming.generation,
		incoming.revision,
	)) return 'stale';
	if (incoming.generation > current.generation) return 'accepted';
	if (incoming.documentId !== current.documentId || incoming.origin !== current.origin) {
		return 'identity-conflict';
	}
	return incoming.revision < current.revision ? 'stale' : 'accepted';
}
