import { executeRegex, replaceMatches } from './core';
import type { RegexWorkerRequest, RegexWorkerResponse } from './worker-contract';

export function handleRegexWorkerRequest(request: RegexWorkerRequest): RegexWorkerResponse {
	try {
		const matches = executeRegex(request.pattern, request.testString, request.flags);
		return {
			ok: true,
			matches,
			replaced: request.includeReplacement
				? replaceMatches(request.pattern, request.testString, request.replacement, request.flags, matches)
				: '',
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

const workerScope = globalThis as unknown as {
	addEventListener?: (type: 'message', listener: (event: MessageEvent<RegexWorkerRequest>) => void) => void;
	postMessage?: (message: RegexWorkerResponse) => void;
};
if (typeof document === 'undefined' && workerScope.addEventListener && workerScope.postMessage) {
	workerScope.addEventListener('message', (event) => {
		workerScope.postMessage?.(handleRegexWorkerRequest(event.data));
	});
}
