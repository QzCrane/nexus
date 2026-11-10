// goal: project the shortcut gesture through the canonical volume palette
// inv: a prospective route is presentation only; actual lifecycle stays ACK-owned

import {
	resolveAudioVolumeState,
	resolveVolumeTone,
	type AudioSessionPhase,
	type SpectraAudioMode,
	type VolumeBoostRoute,
	type VolumeTone,
} from '@nexus/contracts';

export interface HotkeyVolumeToneFacts {
	volume: number;
	muted: boolean;
	enabled: boolean;
	actualMode: SpectraAudioMode;
	phase: AudioSessionPhase;
	boostRoute: VolumeBoostRoute | undefined;
	prospectiveBoostRoute?: VolumeBoostRoute;
}

function predictBoostRoute(facts: HotkeyVolumeToneFacts): VolumeBoostRoute {
	return facts.boostRoute ?? null;
}

// One predicate answers "is the processor live": the acknowledged one. A
// surface that re-derived it could disagree with the wire state it is
// painting beside.
function captureActive(facts: HotkeyVolumeToneFacts): boolean {
	return resolveAudioVolumeState({
		volume: facts.volume,
		muted: facts.muted,
		actualMode: facts.actualMode,
		phase: facts.phase,
	}) === 'capture';
}

export function resolveHotkeyVolumeTone(facts: HotkeyVolumeToneFacts): VolumeTone {
	return resolveVolumeTone({
		volume: facts.volume,
		muted: facts.muted,
		enabled: facts.enabled,
		captureActive: captureActive(facts),
		predict: true,
		boostRoute: predictBoostRoute(facts),
		prospectiveBoostRoute: facts.prospectiveBoostRoute,
	});
}

// post: a settled repaint may land only on acknowledged facts, so it takes the
// same decision as the wire state (`resolveAudioVolumeState`) and never the
// gesture's prospective Boost candidate. Prediction belongs to the pending
// frame; passing a candidate here painted Capture for a processor that had not
// started, and could fail, which is the colour-that-arrives-and-leaves this
// palette forbids (05-control-state §11.2).
export function resolveSettledVolumeTone(facts: HotkeyVolumeToneFacts): VolumeTone {
	return resolveVolumeTone({
		volume: facts.volume,
		muted: facts.muted,
		enabled: facts.enabled,
		captureActive: captureActive(facts),
	});
}
