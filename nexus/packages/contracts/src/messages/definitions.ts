// goal: request/response protocol definitions for the remaining shared Nexus messaging actions

export interface NexusMessages {
	// HALO Tools. SPECTRA V1 actions are intentionally absent; SPECTRA owns its
	// strict versioned envelope in spectra.protocol.ts.
	'HALO_GET_STATUS': { req: undefined; res: { hostname: string; activeTools: string[] } };
	'HALO_TOOL_ACTIVATE': { req: { toolId: string }; res: { success: boolean; toolId?: string; error?: string } };
	'HALO_TOOL_DEACTIVATE': { req: { toolId: string }; res: { success: boolean } };
	'HALO_RULER_START': { req: undefined; res: { success: boolean } };
	'HALO_RULER_CANCEL': { req: undefined; res: { success: boolean } };
	'HALO_RULER_RESULT': { req: { data: unknown }; res: undefined };
	'HALO_SCROLL_TO_HEADING': { req: { index: number }; res: { success: boolean; error?: string } };
	'HALO_CLIPBOARD_ADD': { req: { text: string; sourceUrl?: string; sourceTitle?: string }; res: undefined };
}

export type NexusAction = keyof NexusMessages;
export type NexusRequest<A extends NexusAction> = NexusMessages[A]['req'];
type NexusNoResponse = ReturnType<() => void>;
export type NexusResponse<A extends NexusAction> = NexusMessages[A]['res'] extends undefined
	? NexusNoResponse
	: NexusMessages[A]['res'];
