// goal: pure admission of Content acknowledgements into the coordinator's exact transaction identity
// inv: this module validates values only; it never commits, persists, publishes, or invokes Chrome

import type { ControlApplyAck, ControlIntent, ControlOperationAck, ControlOperationIntent } from '@nexus/contracts';

export function controlApplyAckMatches(ack: ControlApplyAck, intent: ControlIntent): boolean {
	return ack.intentId === intent.intentId
		&& ack.tabId === intent.tabId
		&& ack.documentId === intent.documentId
		&& ack.generation === intent.generation
		&& ack.revision === intent.baseRevision + 1
		&& (!ack.target || ack.target.documentId === intent.documentId);
}

export function controlOperationAckMatches(ack: ControlOperationAck, intent: ControlOperationIntent): boolean {
	return ack.operationId === intent.operationId
		&& ack.tabId === intent.tabId
		&& ack.documentId === intent.documentId
		&& ack.generation === intent.generation
		&& ack.revision === intent.baseRevision + 1
		&& ack.operation === intent.operation
		&& (!ack.target || ack.target.documentId === intent.documentId);
}
