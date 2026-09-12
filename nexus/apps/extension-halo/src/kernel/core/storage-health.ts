// goal: report persistence uncertainty without exposing keys or user contents
export type StorageHealth = 'read-error' | 'write-error' | 'write-unknown' | 'invalid-data';
interface Problem { status: StorageHealth; retry: (() => void) | null; message: string | null; }
const problems = new Map<symbol, Problem>();
const listeners = new Set<() => void>();
let revision = 0;
export function reportStorageHealth(owner: symbol, status: StorageHealth | null, retry: (() => void) | null = null, message: string | null = null): void {
	if (status === null) { if (!problems.delete(owner)) return; }
	else problems.set(owner, { status, retry, message });
	revision++;
	for (const listener of [...listeners]) listener();
}
export function subscribeStorageHealth(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function storageHealthRevision(): number { return revision; }
export function storageProblemCount(): number { return problems.size; }
export function storageProblemMessage(): string | null {
	return [...problems.values()].find((problem) => problem.message)?.message ?? null;
}
export function retryStorageProblems(): void {
	for (const { retry } of [...problems.values()]) retry?.();
}
