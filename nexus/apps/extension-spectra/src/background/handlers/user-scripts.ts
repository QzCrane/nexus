// goal: handles execution of user-defined scripts via chrome.userScripts API
// note: provides a secure alternative to eval() for custom JS functionality

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	rpcFailure,
	rpcSuccess,
} from '@nexus/contracts';
import { router } from '../state';
import { swLog } from '../../shared/logger';

// eff: checks if userScripts API is available and enabled by user
async function isUserScriptsAvailable(): Promise<boolean> {
	try {
		await chrome.userScripts.getScripts();
		return true;
	} catch {
		return false;
	}
}

// eff: configures the USER_SCRIPT world to allow eval-like functionality
async function initUserScriptsWorld(): Promise<void> {
	try {
		await chrome.userScripts.configureWorld({
			csp: "script-src 'self' 'unsafe-inline'",
		});
		swLog.debug('UserScripts world configured');
	} catch (e) {
		swLog.warn('Failed to configure userScripts world:', e);
	}
}

const userScriptsWorldReady = initUserScriptsWorld();

// eff: executes user-provided script in the target tab's MAIN world
async function executeUserScript(tabId: number, script: string): Promise<{ success: boolean; error?: string }> {
	const available = await isUserScriptsAvailable();
	if (!available) {
		return {
			success: false,
			error: 'userScripts API not enabled. Please enable "Allow User Scripts" in extension settings.',
		};
	}

	try {
		await userScriptsWorldReady;
		await chrome.userScripts.execute({
			target: { tabId },
			js: [{ code: script }],
			world: 'USER_SCRIPT',
			injectImmediately: true,
		});
		return { success: true };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		swLog.error('UserScript execution failed:', message);
		return { success: false, error: message };
	}
}

// eff: registers handler for USER_SCRIPT_EXECUTE messages from content script
export function registerUserScriptsHandler(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!isRecord(message)
			|| message.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| message.type !== 'spectra.user-script.execute') return false;
		if (sender.id !== chrome.runtime.id || !sender.tab?.id) {
			sendResponse(rpcFailure('forbidden', 'User scripts require an extension content-script context'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)) {
			sendResponse(rpcFailure('invalid_request', 'Malformed SPECTRA v2 user-script request'));
			return false;
		}
		if (message.type !== 'spectra.user-script.execute') return false;
		void executeUserScript(sender.tab.id, message.payload.script)
			.then((result) => {
				sendResponse(result.success
					? rpcSuccess({ executed: true as const })
					: rpcFailure('user_script_failed', result.error ?? 'Script execution failed'));
			})
			.catch((error: unknown) => {
				sendResponse(rpcFailure(
					'user_script_unavailable',
					error instanceof Error ? error.message : String(error),
					true,
				));
			});
		return true;
	});

	router.on('USER_SCRIPT_EXECUTE', async (req, sender) => {
		const tabId = sender.tab?.id;
		if (!tabId) {
			return { success: false, error: 'No tab context' };
		}
		if (!req.script) {
			return { success: false, error: 'No script provided' };
		}
		return executeUserScript(tabId, req.script);
	});

	swLog.debug('UserScripts handler registered');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
