// goal: one validated SidePanel activation envelope for background user entrypoints
// inv: only ready tools with an implemented payload consumer enter this protocol

export const SIDEPANEL_QR_PREFILL_KEY = 'halo:activation:qrcode:text';
const MAX_PREFILL_TEXT = 8_192;

export type SidepanelActivation =
	| { type: 'HALO_ACTIVATE_TOOL'; toolId: 'color-picker' }
	| { type: 'HALO_ACTIVATE_TOOL'; toolId: 'qrcode'; payload: { text: string } };

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
