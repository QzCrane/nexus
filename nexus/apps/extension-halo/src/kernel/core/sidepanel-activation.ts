// goal: one validated SidePanel activation envelope for background user entrypoints
// inv: only ready tools with an implemented payload consumer enter this protocol

export const SIDEPANEL_ACTIVATION_STORAGE_KEY = 'halo_sidepanel_pending_activation_v1';
export const SIDEPANEL_ACTIVATION_TTL_MS = 5 * 60_000;
const MAX_PREFILL_TEXT = 8_192;

export type SidepanelActivation =
	| { type: 'HALO_ACTIVATE_TOOL'; toolId: 'color-picker' }
	| { type: 'HALO_ACTIVATE_TOOL'; toolId: 'qrcode'; payload: { text: string } };

export interface SidepanelActivationEnvelope {
	schemaVersion: 1;
	id: string;
	generation: number;
	createdAt: number;
	activation: SidepanelActivation;
}

export interface SidepanelActivationDelivery {
	type: 'HALO_SIDEPANEL_ACTIVATION_DELIVER';
	envelope: SidepanelActivationEnvelope;
}

export interface SidepanelActivationAck {
	type: 'HALO_SIDEPANEL_ACTIVATION_ACK';
	id: string;
}

export function parseSidepanelActivation(value: unknown): SidepanelActivation | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.type !== 'HALO_ACTIVATE_TOOL') return null;
	if (candidate.toolId === 'color-picker') return { type: 'HALO_ACTIVATE_TOOL', toolId: 'color-picker' };
	if (candidate.toolId !== 'qrcode' || typeof candidate.payload !== 'object' || candidate.payload === null) return null;
	const text = (candidate.payload as Record<string, unknown>).text;
	if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PREFILL_TEXT) return null;
	return { type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text } };
}

export function activationToolId(value: SidepanelActivation): SidepanelActivation['toolId'] {
	return value.toolId;
}

export function createSidepanelActivationEnvelope(
	id: string,
	activation: SidepanelActivation,
	createdAt = Date.now(),
	generation = createdAt,
): SidepanelActivationEnvelope {
	if (!/^[a-zA-Z0-9_-]{16,128}$/u.test(id)) throw new Error('invalid sidepanel activation ID');
	if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('invalid sidepanel activation generation');
	return { schemaVersion: 1, id, generation, createdAt, activation };
}

export function parseSidepanelActivationEnvelope(value: unknown): SidepanelActivationEnvelope | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.schemaVersion !== 1
		|| typeof candidate.id !== 'string'
		|| !/^[a-zA-Z0-9_-]{16,128}$/u.test(candidate.id)
		|| typeof candidate.generation !== 'number'
		|| !Number.isSafeInteger(candidate.generation)
		|| candidate.generation < 1
		|| typeof candidate.createdAt !== 'number'
		|| !Number.isSafeInteger(candidate.createdAt)) return null;
	const activation = parseSidepanelActivation(candidate.activation);
	return activation
		? {
			schemaVersion: 1,
			id: candidate.id,
			generation: candidate.generation,
			createdAt: candidate.createdAt,
			activation,
		}
		: null;
}

export function parseSidepanelActivationDelivery(value: unknown): SidepanelActivationEnvelope | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	return candidate.type === 'HALO_SIDEPANEL_ACTIVATION_DELIVER'
		? parseSidepanelActivationEnvelope(candidate.envelope)
		: null;
}

export function parseSidepanelActivationAck(value: unknown): SidepanelActivationAck | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	return candidate.type === 'HALO_SIDEPANEL_ACTIVATION_ACK'
		&& typeof candidate.id === 'string'
		&& /^[a-zA-Z0-9_-]{16,128}$/u.test(candidate.id)
		? { type: 'HALO_SIDEPANEL_ACTIVATION_ACK', id: candidate.id }
		: null;
}

export function isFreshSidepanelActivation(
	envelope: SidepanelActivationEnvelope,
	now = Date.now(),
): boolean {
	return envelope.createdAt <= now
		&& now - envelope.createdAt <= SIDEPANEL_ACTIVATION_TTL_MS;
}
