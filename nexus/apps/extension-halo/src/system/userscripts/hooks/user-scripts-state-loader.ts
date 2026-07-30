import type { UserScriptState } from '../types';

export interface UserScriptsStateLoader {
	activate: () => void;
	dispose: () => void;
	load: () => Promise<void>;
}

export function createUserScriptsStateLoader(
	readState: () => Promise<UserScriptState>,
	commitState: (state: UserScriptState) => void,
	reportError: (error: unknown) => void,
): UserScriptsStateLoader {
	let active = false;
	let latestRequest = 0;

	return {
		activate() {
			active = true;
		},
		dispose() {
			active = false;
			latestRequest += 1;
		},
		async load() {
			const request = ++latestRequest;
			try {
				const state = await readState();
				if (active && request === latestRequest) {
					commitState(state);
				}
			} catch (error: unknown) {
				if (active && request === latestRequest) {
					reportError(error);
				}
			}
		},
	};
}
