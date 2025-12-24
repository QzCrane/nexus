/**
 * NEXUS 消息 Action 定义 (单一真相源)
 * 
 * 所有消息名称在这里统一定义，类型和常量都从这里派生
 */

// ========== 消息名称列表 ==========
export const NEXUS_ACTIONS = [
	'AUDIO_GET_STATUS',
	'AUDIO_SET_CONFIG',
	'AUDIO_GET_VISUALIZER',
	'CAPTURE_TOGGLE',
	'CAPTURE_GET_STATE',
	'CAPTURE_UPDATE_CONFIG',
	'CAPTURE_STATE_CHANGE',
	'SETTINGS_UPDATE',
	'SETTINGS_GET',
	'BADGE_UPDATE',
	'BADGE_CLEAR',
	'UI_SYNC',
	'SHORTCUT_TRIGGER',
	'REGISTRY_ADD_DOMAIN',
	'REGISTRY_REMOVE_DOMAIN',
	'REGISTRY_QUERY_DOMAIN',
	'REGISTRY_MARK_PROBED',
	'MEDIA_TOGGLE_PLAY',
	'MEDIA_TOGGLE_PIP',
	'MEDIA_SET_SPEED',
	'MEDIA_GET_STATE',
	'VIDEO_ROTATE',
	'VIDEO_MIRROR',
	'VIDEO_SCREENSHOT',
	'VIDEO_FULLSCREEN',
	'VIDEO_CROP',
	'VIDEO_SEEK',
	'VIDEO_SET_FILTER',
	'VIDEO_RESET_FILTER',
	'VIDEO_DIM_BACKGROUND',
	'TAB_REPORT_MEDIA',
	'TAB_GET_VISIBLE_TABS',
	'GLOBAL_SETTINGS_UPDATE',
] as const;

export const OFFSCREEN_ACTIONS = [
	'OFFSCREEN_START',
	'OFFSCREEN_STOP',
	'OFFSCREEN_UPDATE_CONFIG',
	'OFFSCREEN_GET_VIZ',
] as const;

// ========== 类型 ==========
export type NexusActionName = typeof NEXUS_ACTIONS[number];
export type OffscreenActionName = typeof OFFSCREEN_ACTIONS[number];

// ========== 运行时常量对象 (自动生成) ==========
type ActionMap<T extends readonly string[]> = { [K in T[number]]: K };

function createActionMap<T extends readonly string[]>(actions: T): ActionMap<T> {
	const map = {} as ActionMap<T>;
	for (const action of actions) {
		(map as Record<string, string>)[action] = action;
	}
	return map;
}

/** NEXUS 消息常量 */
export const Actions = createActionMap(NEXUS_ACTIONS);

/** Offscreen 消息常量 */
export const OffscreenActions = createActionMap(OFFSCREEN_ACTIONS);
