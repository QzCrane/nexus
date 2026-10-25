export interface NexusMessages {
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

export const NEXUS_ACTIONS = [
	'HALO_GET_STATUS',
	'HALO_TOOL_ACTIVATE',
	'HALO_TOOL_DEACTIVATE',
	'HALO_RULER_START',
	'HALO_RULER_CANCEL',
	'HALO_RULER_RESULT',
	'HALO_SCROLL_TO_HEADING',
	'HALO_CLIPBOARD_ADD',
] as const satisfies readonly NexusAction[];

const _allProtocolActionsAreListed: Exclude<NexusAction, typeof NEXUS_ACTIONS[number]> extends never
	? true
	: never = true;
void _allProtocolActionsAreListed;

export type NexusActionName = typeof NEXUS_ACTIONS[number];

type ActionMap<T extends readonly string[]> = { [K in T[number]]: K };

function createActionMap<T extends readonly string[]>(actions: T): ActionMap<T> {
	const map = {} as ActionMap<T>;
	for (const action of actions) {
		(map as Record<string, string>)[action] = action;
	}
	return map;
}

export const Actions = createActionMap(NEXUS_ACTIONS);
