// goal: keep every document-facing lifecycle operation on one URL admission policy
// inv: runtime admission and update reconciliation classify the same URL set

/**
 * Returns whether Chrome may host SPECTRA's document-scoped content runtime.
 *
 * The policy deliberately includes file URLs. Chrome only exposes those pages
 * to an extension after the user enables "Allow access to file URLs", but once
 * that capability is granted they are part of the same `<all_urls>` surface as
 * HTTP(S) documents. Callers must still treat a missing URL or a failed
 * injection as an explicit outcome; this predicate only classifies the URL.
 */
export function isContentDocumentUrl(url: string): boolean {
	try {
		const protocol = new URL(url).protocol;
		return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
	} catch {
		return false;
	}
}
