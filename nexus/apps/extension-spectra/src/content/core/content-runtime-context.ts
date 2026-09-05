// goal: provide one immutable document identity and bounded cancellation fences

import type { MediaTarget } from '@nexus/contracts';

export type ContentLifecycleErrorCode =
	| 'stale-document'
	| 'stale-media-source'
	| 'cancelled'
	| 'deadline-exceeded';

/**
 * A lifecycle failure is deliberately distinct from a capability failure.
 * Callers must not turn one of these into a successful ACK or retry it through
 * another writer.  In particular, a source change is a new resource even when
 * the page reuses the same DOM element.
 */
export class ContentLifecycleError extends Error {
	readonly code: ContentLifecycleErrorCode;
	readonly retryable = false;

	constructor(code: ContentLifecycleErrorCode, message: string) {
		super(message);
		this.name = 'ContentLifecycleError';
		this.code = code;
	}
}

export function isContentLifecycleError(error: unknown): error is ContentLifecycleError {
	return error instanceof ContentLifecycleError;
}

export interface DocumentRuntimeIdentity {
	readonly documentId: string;
	readonly frameId: number;
}

export interface MediaOperationFence {
	readonly runtimeEpoch: number;
	readonly target: Readonly<MediaTarget>;
}

let nextRuntimeEpoch = 1;

function requireDocumentId(documentId: string): string {
	const value = documentId.trim();
	if (!value) {
		throw new ContentLifecycleError(
			'stale-document',
			'Content runtime cannot start without a non-empty document identity',
		);
	}
	return value;
}

/**
 * The runtime context is created before the media registry.  It has no setter
 * for document identity: changing a document is represented by disposal and a
 * new context, never by retagging already-registered media.
 */
export class DocumentRuntimeContext {
	readonly identity: DocumentRuntimeIdentity;
	readonly runtimeEpoch = nextRuntimeEpoch++;
	private readonly controller = new AbortController();
	private disposed = false;

	constructor(identity: DocumentRuntimeIdentity) {
		if (identity.frameId !== 0) {
			throw new ContentLifecycleError(
				'stale-document',
				'SPECTRA Content runtime is restricted to the top-level document',
			);
		}
		this.identity = Object.freeze({
			documentId: requireDocumentId(identity.documentId),
			frameId: identity.frameId,
		});
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	capture(target: MediaTarget): MediaOperationFence {
		this.assertOpen();
		if (target.documentId !== this.identity.documentId
			|| target.frameId !== this.identity.frameId) {
			throw new ContentLifecycleError(
				'stale-document',
				'The media target belongs to a different document runtime',
			);
		}
		return {
			runtimeEpoch: this.runtimeEpoch,
			target: Object.freeze({ ...target }),
		};
	}

	assertOpen(): void {
		if (this.disposed || this.signal.aborted) {
			throw new ContentLifecycleError(
				'cancelled',
				'Content runtime lifecycle has ended',
			);
		}
	}

	assertFence(fence: MediaOperationFence, target: MediaTarget | null | undefined): void {
		this.assertOpen();
		if (fence.runtimeEpoch !== this.runtimeEpoch) {
			throw new ContentLifecycleError(
				'cancelled',
				'The media operation belongs to an expired runtime epoch',
			);
		}
		if (!target || !sameMediaTarget(fence.target, target)) {
			throw new ContentLifecycleError(
				fence.target.documentId === this.identity.documentId
					? 'stale-media-source'
					: 'stale-document',
				'The media source changed before the asynchronous operation committed',
			);
		}
	}

	/** Cancel every operation owned by this document runtime exactly once. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controller.abort(new ContentLifecycleError('cancelled', 'Content runtime disposed'));
	}
}

export function sameMediaTarget(
	left: Pick<MediaTarget, 'frameId' | 'documentId' | 'mediaId' | 'sourceRevision' | 'kind'>,
	right: Pick<MediaTarget, 'frameId' | 'documentId' | 'mediaId' | 'sourceRevision' | 'kind'>,
): boolean {
	return left.frameId === right.frameId
		&& left.documentId === right.documentId
		&& left.mediaId === right.mediaId
		&& left.sourceRevision === right.sourceRevision
		&& left.kind === right.kind;
}

export function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw abortError(signal);
	}
}

export function abortError(signal?: AbortSignal): ContentLifecycleError {
	const reason = signal?.reason;
	if (reason instanceof ContentLifecycleError) return reason;
	return new ContentLifecycleError('cancelled', 'The media operation was cancelled');
}

export interface AnimationBoundaryOptions {
	signal?: AbortSignal;
	/** Maximum wait in milliseconds, including a suspended/hidden-tab rAF. */
	deadlineMs?: number;
}

/**
 * A bounded animation boundary.  Every completion path removes its listener,
 * clears its deadline and cancels the frame, so disposal cannot leave a promise
 * pending and a hidden tab cannot hold an operation forever.
 */
export function waitForAnimationBoundary(
	options: AnimationBoundaryOptions = {},
): Promise<void> {
	assertNotAborted(options.signal);
	const deadlineMs = Math.max(1, options.deadlineMs ?? 250);
	if (typeof requestAnimationFrame !== 'function') {
		return new Promise((resolve, reject) => {
			let settled = false;
			let timerId: ReturnType<typeof setTimeout> | null = null;
			const finish = (error?: ContentLifecycleError): void => {
				if (settled) return;
				settled = true;
				if (timerId !== null) clearTimeout(timerId);
				options.signal?.removeEventListener('abort', onAbort);
				if (error) reject(error);
				else resolve();
			};
			const onAbort = (): void => finish(
				new ContentLifecycleError('cancelled', 'The animation boundary was cancelled'),
			);
			timerId = setTimeout(() => finish(
				new ContentLifecycleError('deadline-exceeded', 'Animation boundary deadline exceeded'),
			), deadlineMs);
			options.signal?.addEventListener('abort', onAbort, { once: true });
		});
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		let frameId: number | null = null;
		let timerId: ReturnType<typeof setTimeout> | null = null;
		const finish = (error?: ContentLifecycleError): void => {
			if (settled) return;
			settled = true;
			if (timerId !== null) clearTimeout(timerId);
			options.signal?.removeEventListener('abort', onAbort);
			if (frameId !== null && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(frameId);
			}
			if (error) reject(error);
			else resolve();
		};
		const onAbort = (): void => finish(
			new ContentLifecycleError('cancelled', 'The animation boundary was cancelled'),
		);
		timerId = setTimeout(() => finish(
			new ContentLifecycleError('deadline-exceeded', 'Animation boundary deadline exceeded'),
		), deadlineMs);
		options.signal?.addEventListener('abort', onAbort, { once: true });
		frameId = requestAnimationFrame(() => finish());
	});
}
