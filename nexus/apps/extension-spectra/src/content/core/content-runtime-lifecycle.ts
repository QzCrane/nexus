// goal: retire one document runtime before any asynchronous release boundary

import type { DocumentRuntimeContext } from './content-runtime-context';

export interface ContentRuntimeDisposal {
	readonly context?: DocumentRuntimeContext;
	readonly handoff: boolean;
	readonly disposeSynchronous: () => void;
	readonly release?: () => Promise<void>;
	readonly finalize: () => void;
}

/**
 * A document identity is authority, not metadata.  Its cancellation scope and
 * every document-owned side effect are retired synchronously before an audio
 * or IPC release may yield.  Final bookkeeping runs even when physical release
 * fails so a dead generation can never remain advertised as READY.
 */
export async function disposeContentRuntimeLifecycle(
	disposal: ContentRuntimeDisposal,
): Promise<void> {
	disposal.context?.dispose();
	disposal.disposeSynchronous();
	try {
		if (!disposal.handoff) await disposal.release?.();
	} finally {
		disposal.finalize();
	}
}
