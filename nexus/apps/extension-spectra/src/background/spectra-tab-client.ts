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

// A view read must not change the page it describes. Every passive field a
// control snapshot needs is answerable by the manifest-injected bootstrap, so a
// reader that only wants to render current state must never be able to acquire
// the document runtime: acquiring it injects the heavy runtime into a tab the
// user has not opened, which is exactly the write a background card must not
// cause. The allow-list keeps that boundary enforced instead of conventional.
const PASSIVE_READ_TYPES: ReadonlySet<SpectraRequestType> = new Set([
	'spectra.control.actual.read',
]);

// post: one page read through the lean bootstrap, never through a runtime lease.
// A document that would need the runtime answers `content_runtime_not_loaded`;
// the caller reports what it already knows instead of waking the tab.
export async function readSpectraTabPassively<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<BackgroundRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	if (!PASSIVE_READ_TYPES.has(type)) {
		throw new Error(`${type} is not a passive document read`);
	}
	return sendBackgroundTabRequestOnce(tabId, type, payload, context);
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
