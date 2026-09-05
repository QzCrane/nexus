// goal: owns the tab-scoped monotonic admission rule for every Popup projection of ControlSnapshot

import type { ControlSnapshot } from '@nexus/contracts';

export type ControlSnapshotAdmission =
	| 'accepted'
	| 'stale'
	| 'tab-conflict'
	| 'identity-conflict';

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
	if (incoming.generation < current.generation) return 'stale';
	if (incoming.generation > current.generation) return 'accepted';
	if (incoming.documentId !== current.documentId || incoming.origin !== current.origin) {
		return 'identity-conflict';
	}
	return incoming.revision < current.revision ? 'stale' : 'accepted';
}
