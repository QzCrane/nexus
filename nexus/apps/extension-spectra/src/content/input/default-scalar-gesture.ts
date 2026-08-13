// goal: share exact hotkey gesture lifecycle between the document-start
// bootstrap input owner and the lazily mounted full Content runtime

import type { SpectraDefaultHotkeyAction } from '@nexus/contracts/bootstrap';

export interface DefaultScalarGestureSignal {
	gesture: string;
	action: SpectraDefaultHotkeyAction;
	phase: 'press' | 'release' | 'settled';
	repeated: boolean;
}

export type HotkeyReplaySignal =
	| { type: 'gesture'; signal: DefaultScalarGestureSignal }
	| { type: 'feedback'; message: unknown };

type HotkeyReplayListener = (signal: HotkeyReplaySignal) => void;

export interface PhysicalHotkeyReleaseSignal {
	code: string;
}

type PhysicalHotkeyReleaseListener = (signal: PhysicalHotkeyReleaseSignal) => void;

interface HotkeyGestureChannel {
	version: 4;
	sequence: number;
	releasedSequences: Record<'default' | 'site', number>;
	replayListeners: Set<HotkeyReplayListener>;
	pendingReplay: HotkeyReplaySignal[];
	releaseListeners: Set<PhysicalHotkeyReleaseListener>;
}

// V4 intentionally uses a new global identity: V3 used separate gesture and
// feedback queues, so accepting its shape as the ordered replay owner would
// make mixed-version reinjection crash or reorder an in-flight gesture.
const CHANNEL_KEY = '__spectraHotkeyGestureV4';
const MAX_PENDING_SIGNALS = 160;

type GestureGlobal = typeof globalThis & {
	[CHANNEL_KEY]?: HotkeyGestureChannel;
	__spectraHotkeyGestureV3?: { sequence?: unknown };
};

function gestureIdentity(gesture: string): { namespace: 'default' | 'site'; sequence: number } | null {
	const match = /^(default|site):([1-9]\d*)$/u.exec(gesture);
	if (!match) return null;
	const sequence = Number(match[2]);
	if (!Number.isSafeInteger(sequence)) return null;
	return { namespace: match[1] as 'default' | 'site', sequence };
}

function channel(): HotkeyGestureChannel {
	const owner = globalThis as GestureGlobal;
	const current = owner[CHANNEL_KEY];
	if (current?.version === 4) return current;
	const legacySequence = owner.__spectraHotkeyGestureV3?.sequence;
	const created: HotkeyGestureChannel = {
		version: 4,
		// Preserve only the monotonic identity watermark across V3 -> V4. Its
		// incompatible listeners and split pending queues are deliberately retired.
		sequence: Number.isSafeInteger(legacySequence) && Number(legacySequence) >= 0
			? Number(legacySequence)
			: 0,
		releasedSequences: { default: 0, site: 0 },
		replayListeners: new Set(),
		pendingReplay: [],
		releaseListeners: new Set(),
	};
	owner[CHANNEL_KEY] = created;
	return created;
}

// One isolated-world sequence survives bootstrap/runtime reinjection, so a
// late release from an older bundle can never settle a newer gesture.
export function nextScalarGestureId(namespace: 'default' | 'site'): string {
	const owner = channel();
	owner.sequence = owner.sequence >= Number.MAX_SAFE_INTEGER ? 1 : owner.sequence + 1;
	return `${namespace}:${owner.sequence}`;
}

export function publishDefaultScalarGesture(signal: DefaultScalarGestureSignal): void {
	if (signal.phase === 'release' || signal.phase === 'settled') {
		const identity = gestureIdentity(signal.gesture);
		if (identity) {
			const owner = channel();
			owner.releasedSequences[identity.namespace] = Math.max(
				owner.releasedSequences[identity.namespace],
				identity.sequence,
			);
		}
	}
	publishReplaySignal({ type: 'gesture', signal });
}

export function isHotkeyGestureReleased(gesture: string): boolean {
	const identity = gestureIdentity(gesture);
	return identity !== null
		&& identity.sequence <= channel().releasedSequences[identity.namespace];
}

export function subscribeHotkeyReplay(
	listener: HotkeyReplayListener,
): () => void {
	const owner = channel();
	owner.replayListeners.add(listener);
	const pending = owner.pendingReplay.splice(0);
	for (const signal of pending) listener(signal);
	return () => owner.replayListeners.delete(listener);
}

// The document-start bootstrap is the durable delivery owner for exact-document
// background ACKs. A full runtime can be replaced between physical acceptance
// and processor settlement, so feedback uses the same bounded replay channel as
// the gesture phases instead of depending on one transient runtime listener.
export function publishHotkeyActualFeedback(message: unknown): void {
	publishReplaySignal({ type: 'feedback', message });
}

function publishReplaySignal(signal: HotkeyReplaySignal): void {
	const owner = channel();
	if (owner.replayListeners.size === 0) {
		if (owner.pendingReplay.length >= MAX_PENDING_SIGNALS) owner.pendingReplay.shift();
		owner.pendingReplay.push(signal);
		return;
	}
	for (const listener of owner.replayListeners) listener(signal);
}

// Site bindings can only become active after the full runtime subscribes, so
// releases need no replay queue. Bootstrap publishes them synchronously from
// its document-start capture observer before website propagation can hide them.
export function publishPhysicalHotkeyRelease(signal: PhysicalHotkeyReleaseSignal): void {
	for (const listener of channel().releaseListeners) listener(signal);
}

export function subscribePhysicalHotkeyRelease(
	listener: PhysicalHotkeyReleaseListener,
): () => void {
	const owner = channel();
	owner.releaseListeners.add(listener);
	return () => owner.releaseListeners.delete(listener);
}
