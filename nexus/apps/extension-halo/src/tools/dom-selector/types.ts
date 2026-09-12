export interface DomSelection {
	css: string;
	xpath: string;
}

export interface DomSelectedMessage {
	type: 'HALO_DOM_SELECTED';
	operationId: string;
	payload: DomSelection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isDomSelectedMessage(value: unknown): value is DomSelectedMessage {
	if (!isRecord(value) || value.type !== 'HALO_DOM_SELECTED' || !isRecord(value.payload)) {
		return false;
	}

	return typeof value.operationId === 'string' && value.operationId.length > 0
		&& typeof value.payload.css === 'string' && typeof value.payload.xpath === 'string';
}
