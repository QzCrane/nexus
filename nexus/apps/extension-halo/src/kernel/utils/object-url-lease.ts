export interface ObjectUrlLease {
	readonly url: string;
	release(): void;
}

export function createObjectUrlLease(blob: Blob): ObjectUrlLease {
	const url = URL.createObjectURL(blob);
	let released = false;
	return {
		url,
		release() {
			if (released) return;
			released = true;
			URL.revokeObjectURL(url);
		},
	};
}

export class ObjectUrlSlot {
	private lease: ObjectUrlLease | null = null;

	replace(blob: Blob): string {
		this.clear();
		this.lease = createObjectUrlLease(blob);
		return this.lease.url;
	}

	clear(): void {
		this.lease?.release();
		this.lease = null;
	}
}

export function downloadBlob(blob: Blob, filename: string): void {
	const lease = createObjectUrlLease(blob);
	const anchor = document.createElement('a');
	anchor.href = lease.url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Navigation/download consumes the URL in a later browser task. Synchronous
	// revocation races that consumer and can produce an empty download.
	setTimeout(() => lease.release(), 0);
}
