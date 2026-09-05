// goal: deliver Background-owned tab RPCs through the local Content runtime owner

import type {
	SpectraRequestPayload,
	SpectraRequestType,
	SpectraResponse,
} from '@nexus/contracts';
import { requiresContentRuntime } from '../shared/content-runtime';
import {
	sendBackgroundTabRequestOnce,
	type BackgroundRequestContext,
} from './background-rpc';
import {
	ensureContentRuntime,
	releaseContentRuntimeLease,
} from './runtime-loader';

function requestCapability(): string {
	return typeof crypto.randomUUID === 'function'
		? `request:${crypto.randomUUID()}`
		: `request:${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

// Background is the Content runtime lifecycle owner. It must acquire that
// runtime locally instead of sending an ensure RPC to its own MV3 worker, which
// Chrome does not loop back to the sending context.
export async function sendSpectraTabRequest<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<BackgroundRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	if (!requiresContentRuntime(type)) {
		return sendBackgroundTabRequestOnce(tabId, type, payload, context);
	}

	const reason = type === 'spectra.hotkey.trigger' ? 'hotkey' : 'control';
	const capability = requestCapability();
	const runtime = await ensureContentRuntime(
		tabId,
		context.documentId,
		reason,
		capability,
	);
	try {
		return await sendBackgroundTabRequestOnce(tabId, type, payload, {
			...context,
			documentId: runtime.documentId,
		});
	} finally {
		releaseContentRuntimeLease(
			tabId,
			runtime.documentId,
			reason,
			capability,
		);
	}
}
