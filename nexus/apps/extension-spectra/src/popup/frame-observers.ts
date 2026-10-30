// goal: keep exactly one pair of frame observers alive in the Popup
//
// Tracking the frame is a restartable activity: a Popup that retries its
// bootstrap starts tracking again, and a failed bootstrap releases the frame
// so its error surface can show. Both must end with exactly one live pair of
// observers - never two competing writers of the same height, and never one
// that keeps re-sizing a frame it was told to release.
//
// The holder owns that invariant, so it can be pinned without a DOM.

export interface FrameObserver {
	disconnect(): void;
}

export interface FrameObserverPair {
	resize: FrameObserver;
	mutation: FrameObserver;
}

export interface FrameObserverHolder {
	/** Installs a new pair, disconnecting the one it replaces. */
	replace(next: FrameObserverPair): void;
	/** Disconnects the live pair, if there is one. */
	release(): void;
	/** Whether a pair is currently live. */
	readonly live: boolean;
}

export function createFrameObserverHolder(): FrameObserverHolder {
	let current: FrameObserverPair | null = null;
	const disconnect = (pair: FrameObserverPair | null): void => {
		pair?.resize.disconnect();
		pair?.mutation.disconnect();
	};
	return {
		replace(next: FrameObserverPair): void {
			disconnect(current);
			current = next;
		},
		release(): void {
			disconnect(current);
			current = null;
		},
		get live(): boolean {
			return current !== null;
		},
	};
}
