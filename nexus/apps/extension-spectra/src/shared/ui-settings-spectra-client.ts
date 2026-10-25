// goal: send runtime-validated settings UI requests without control-bundle code
// eff: delegates to canonical transport infrastructure without duplicating envelope or id logic

import {
	createSpectraRequest,
	type SpectraRequestPayload,
	type SpectraResponse,
} from '@nexus/contracts';
import {
	isSpectraSettingsUiResponse,
	type SpectraSettingsUiRequestType,
} from '@nexus/contracts/ui-settings-runtime';
import { sendSpectraRpcMessage } from './transport';

export function sendSettingsUiRequest<T extends SpectraSettingsUiRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload);
	return sendSpectraRpcMessage(message, isSpectraSettingsUiResponse, 'Background');
}
