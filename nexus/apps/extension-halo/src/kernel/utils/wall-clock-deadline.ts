// goal: bounded wall-clock deadline watcher for persisted timer anchors
// eff: clock jumps are re-evaluated without high-frequency persistent writes

export interface WallClockDeadlineCallbacks {
	onCheck?: (now: number, remainingMs: number) => void;
	onDue: (now: number) => void;
}

export interface WallClockDeadlineOptions {
	now?: () => number;
	schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clear?: (timer: ReturnType<typeof setTimeout>) => void;
	maxCheckMs?: number;
}

export function watchWallClockDeadline(
	deadline: number,
	callbacks: WallClockDeadlineCallbacks,
	options: WallClockDeadlineOptions = {},
): () => void {
	const now = options.now ?? Date.now;
	const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const clear = options.clear ?? clearTimeout;
	const maxCheckMs = Math.max(1, options.maxCheckMs ?? 1000);
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const check = () => {
		if (disposed) return;
		timer = null;
		const observedNow = now();
		const remainingMs = Math.max(0, deadline - observedNow);
		callbacks.onCheck?.(observedNow, remainingMs);
		if (remainingMs <= 0) {
			callbacks.onDue(observedNow);
			return;
		}
		timer = schedule(check, Math.min(remainingMs, maxCheckMs));
	};

	check();
	return () => {
		disposed = true;
		if (timer !== null) clear(timer);
		timer = null;
	};
}
