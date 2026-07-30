import { useCallback, useEffect, useRef, useState } from 'react';

interface ClipboardCopyCallbacks<Key> {
	onFailure: (error: unknown) => void;
	onReset: () => void;
	onSuccess: (key: Key) => void;
}

interface ClipboardCopyDependencies {
	clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
	schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	writeText: (text: string) => Promise<void>;
}

export interface OwnedClipboardCopyController<Key> {
	activate: () => void;
	copy: (
		key: Key,
		text: string,
		callbacks: ClipboardCopyCallbacks<Key>,
		resetAfterMs: number,
	) => Promise<boolean>;
	dispose: () => void;
}

export function createOwnedClipboardCopyController<Key>(
	dependencies: ClipboardCopyDependencies,
): OwnedClipboardCopyController<Key> {
	let active = false;
	let revision = 0;
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	const clearResetTimer = (): void => {
		if (resetTimer === null) return;
		dependencies.clearTimer(resetTimer);
		resetTimer = null;
	};

	return {
		activate() {
			active = true;
			revision += 1;
		},
		async copy(key, text, callbacks, resetAfterMs) {
			const requestRevision = ++revision;
			clearResetTimer();
			try {
				await dependencies.writeText(text);
				if (!active || requestRevision !== revision) return false;
				callbacks.onSuccess(key);
				resetTimer = dependencies.schedule(() => {
					resetTimer = null;
					if (!active || requestRevision !== revision) return;
					callbacks.onReset();
				}, resetAfterMs);
				return true;
			} catch (error: unknown) {
				if (active && requestRevision === revision) {
					callbacks.onFailure(error);
				}
				return false;
			}
		},
		dispose() {
			active = false;
			revision += 1;
			clearResetTimer();
		},
	};
}

export function useOwnedClipboardCopy<Key>(resetAfterMs = 1500) {
	const [copiedKey, setCopiedKey] = useState<Key | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const controllerRef = useRef<OwnedClipboardCopyController<Key> | null>(null);
	if (controllerRef.current === null) {
		controllerRef.current = createOwnedClipboardCopyController<Key>({
			clearTimer: clearTimeout,
			schedule: setTimeout,
			writeText: (text) => navigator.clipboard.writeText(text),
		});
	}
	const controller = controllerRef.current;

	useEffect(() => {
		controller.activate();
		return () => controller.dispose();
	}, [controller]);

	const copy = useCallback(
		(key: Key, text: string) => {
			setCopyFailed(false);
			return controller.copy(
				key,
				text,
				{
					onFailure: () => {
						setCopiedKey(null);
						setCopyFailed(true);
					},
					onReset: () => setCopiedKey(null),
					onSuccess: setCopiedKey,
				},
				resetAfterMs,
			);
		},
		[controller, resetAfterMs],
	);

	return { copiedKey, copy, copyFailed };
}
