import { createObjectUrlLease, type ObjectUrlLease } from '../../kernel/utils/object-url-lease';

interface TabRemovalEvents {
	addListener(listener: (tabId: number) => void): void;
	removeListener(listener: (tabId: number) => void): void;
}

export class ArchiveViewerUrlOwner {
	private readonly leases = new Map<number, ObjectUrlLease>();
	private listening = false;
	private readonly onRemoved = (tabId: number): void => {
		this.leases.get(tabId)?.release();
		this.leases.delete(tabId);
		this.stopWhenEmpty();
	};

	constructor(
		private readonly createTab: (url: string) => Promise<{ id?: number }>,
		private readonly removals: TabRemovalEvents,
		private readonly tabExists: (tabId: number) => Promise<boolean>,
	) {}

	async open(blob: Blob): Promise<number> {
		const lease = createObjectUrlLease(blob);
		try {
			const tab = await this.createTab(lease.url);
			if (!Number.isInteger(tab.id)) throw new Error('Archive viewer tab has no identity.');
			const tabId = tab.id as number;
			this.leases.set(tabId, lease);
			if (!this.listening) {
				this.removals.addListener(this.onRemoved);
				this.listening = true;
			}
			// The tab can close between tabs.create settling and listener ownership.
			// Install ownership first, then read back identity; onRemoved covers any
			// close after listener installation and this readback covers one before it.
			if (!await this.tabExists(tabId)) {
				this.onRemoved(tabId);
				throw new Error('Archive viewer tab closed before navigation completed.');
			}
			return tabId;
		} catch (error) {
			lease.release();
			throw error;
		}
	}

	dispose(): void {
		for (const lease of this.leases.values()) lease.release();
		this.leases.clear();
		this.stopWhenEmpty();
	}

	get activeLeaseCount(): number {
		return this.leases.size;
	}

	private stopWhenEmpty(): void {
		if (!this.listening || this.leases.size > 0) return;
		this.removals.removeListener(this.onRemoved);
		this.listening = false;
	}
}
