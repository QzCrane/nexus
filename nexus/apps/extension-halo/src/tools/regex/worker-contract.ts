import type { RegexFlags, RegexMatch } from './types';

export const REGEX_WORKER_PATH = 'workers/regex.js';
// JavaScript RegExp has no cooperative interruption point. A short deadline
// terminates the dedicated worker so catastrophic backtracking cannot own UI.
export const REGEX_TASK_DEADLINE_MS = 2_000;

export interface RegexWorkerRequest {
	pattern: string;
	testString: string;
	replacement: string;
	flags: RegexFlags;
	includeReplacement: boolean;
}

export type RegexWorkerResponse =
	| { ok: true; matches: RegexMatch[]; replaced: string }
	| { ok: false; error: string };
