// goal: one owner for fetch response budgets: bounded wall-clock time, capped
// encoded bytes, and explicit cancellation. Every extension-initiated fetch of
// remote content goes through these helpers so no path can buffer unbounded
// response bytes or outlive its lifecycle.

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_FETCH_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Combine a caller-owned cancellation signal with a bounded timeout. The
 * returned signal is already timed; callers abort the input signal to cancel
 * early (for example when the owning surface is disposed).
 */
export function boundedFetchSignal(
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
): AbortSignal {
	const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const timeout = AbortSignal.timeout(timeoutMs);
	if (!options.signal) return timeout;
	return AbortSignal.any([options.signal, timeout]);
}

/**
 * Read a response body up to maxBytes encoded bytes. Larger responses are
 * rejected explicitly instead of silently truncated, and the physical stream
 * is cancelled.
 */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) {
			throw new Error(`response exceeds the ${maxBytes} byte budget`);
		}
		return new Uint8Array(buffer);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			void reader.cancel();
			throw new Error(`response exceeds the ${maxBytes} byte budget`);
		}
		chunks.push(value);
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}
