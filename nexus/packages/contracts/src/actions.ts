// goal: single source of truth for the remaining shared Nexus message action names

import type { NexusAction } from './messages/definitions.js';

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
