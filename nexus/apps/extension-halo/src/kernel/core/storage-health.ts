// goal: report persistence uncertainty without exposing keys or user contents
export type StorageHealth = 'read-error' | 'write-error' | 'write-unknown';
interface Problem { status: StorageHealth; retry: (() => void) | null; }
const problems = new Map<symbol, Problem>();
const listeners = new Set<() => void>();
let revision = 0;
export function reportStorageHealth(owner: symbol, status: StorageHealth | null, retry: (() => void) | null = null): void {
	if (status === null) { if (!problems.delete(owner)) return; }
	else problems.set(owner, { status, retry });
	revision++;
	for (const listener of [...listeners]) listener();
}
export function subscribeStorageHealth(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function storageHealthRevision(): number { return revision; }
export function storageProblemCount(): number { return problems.size; }
export function retryStorageProblems(): void {
	for (const { retry } of [...problems.values()]) retry?.();
}
