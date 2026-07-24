// goal: share exact default-scalar key gesture phases between the lightweight
// bootstrap input owner and the lazily mounted full Content feedback runtime

import type { SpectraDefaultHotkeyAction } from '@nexus/contracts/bootstrap';

export interface DefaultScalarGestureSignal {
	gesture: string;
	action: SpectraDefaultHotkeyAction;
	phase: 'press' | 'release' | 'settled';
	repeated: boolean;
}

type DefaultScalarGestureListener = (signal: DefaultScalarGestureSignal) => void;

interface DefaultScalarGestureChannel {
	version: 2;
	sequence: number;
	listeners: Set<DefaultScalarGestureListener>;
	pending: DefaultScalarGestureSignal[];
}

const CHANNEL_KEY = '__spectraDefaultScalarGestureV2';
const MAX_PENDING_SIGNALS = 160;

type GestureGlobal = typeof globalThis & {
	[CHANNEL_KEY]?: DefaultScalarGestureChannel;
};

function channel(): DefaultScalarGestureChannel {
	const owner = globalThis as GestureGlobal;
	const current = owner[CHANNEL_KEY];
	if (current?.version === 2) return current;
	const created: DefaultScalarGestureChannel = {
		version: 2,
		sequence: 0,
		listeners: new Set(),
		pending: [],
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
	const owner = channel();
	if (owner.listeners.size === 0) {
		if (owner.pending.length >= MAX_PENDING_SIGNALS) owner.pending.shift();
		owner.pending.push(signal);
		return;
	}
	for (const listener of owner.listeners) listener(signal);
}

export function subscribeDefaultScalarGesture(
	listener: DefaultScalarGestureListener,
): () => void {
	const owner = channel();
	owner.listeners.add(listener);
	const pending = owner.pending.splice(0);
	for (const signal of pending) listener(signal);
	return () => owner.listeners.delete(listener);
}
