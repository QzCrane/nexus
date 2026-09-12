// goal: replay a base-revision-carrying control request once after refreshing the
// authoritative snapshot when the Background reports a stale-base-revision race,
// so an explicit user intent is never silently dropped by a concurrent broadcast

import type {
	ControlOperation,
	ControlOperationPayload,
	ControlOperationRequest,
	ControlSubmitRequest,
	SpectraResponse,
} from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { applyControlSnapshot } from './messaging';
import type { CardInternalState } from './types';

export interface ControlIntentRecoveryContext {
	tabId: number;
	state: CardInternalState;
	render: () => void;
}

export const CONTROL_STALE_REVISION = 'control_stale_revision';

// post: pulls the freshest authoritative snapshot into the card projection. The
// refreshed revision becomes the base of the replayed attempt; when the snapshot
// cannot be read the replay simply retries against the previous revision.
async function refreshControlSnapshot(ctx: ControlIntentRecoveryContext): Promise<void> {
	const response = await sendSpectraRequest(
		'spectra.control.snapshot.get',
		{ tabId: ctx.tabId },
		{ tabId: ctx.tabId },
	);
	if (response.ok && response.data) applyControlSnapshot(ctx.state, response.data, ctx.render);
}

export async function submitControlIntent(
	ctx: ControlIntentRecoveryContext,
	body: Pick<ControlSubmitRequest, 'requestedCoverage'> & Partial<Pick<ControlSubmitRequest, 'patch' | 'mutations'>>,
): Promise<SpectraResponse<'spectra.control.intent.submit'>> {
	const attempt = (): Promise<SpectraResponse<'spectra.control.intent.submit'>> => sendSpectraRequest(
		'spectra.control.intent.submit',
		{
			...body,
			source: 'popup',
			target: ctx.state.controlSnapshot?.activeMedia ?? null,
			baseRevision: ctx.state.controlRevision,
		},
		{ tabId: ctx.tabId },
	);
	const response = await attempt();
	if (response.ok || response.error.code !== CONTROL_STALE_REVISION) return response;
	await refreshControlSnapshot(ctx);
	return attempt();
}

export async function submitControlOperation<O extends ControlOperation>(
	ctx: ControlIntentRecoveryContext,
	body: { operation: O; payload: ControlOperationPayload<O> },
): Promise<SpectraResponse<'spectra.control.operation.submit'>> {
	const attempt = (): Promise<SpectraResponse<'spectra.control.operation.submit'>> => sendSpectraRequest(
		'spectra.control.operation.submit',
		{
			...body,
			source: 'popup',
			target: ctx.state.controlSnapshot?.activeMedia ?? null,
			baseRevision: ctx.state.controlRevision,
		} as ControlOperationRequest,
		{ tabId: ctx.tabId },
	);
	const response = await attempt();
	if (response.ok || response.error.code !== CONTROL_STALE_REVISION) return response;
	await refreshControlSnapshot(ctx);
	return attempt();
}
