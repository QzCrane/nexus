// goal: Hover zoom types
// eff: Settings and state definitions

export type TriggerMode = 'hover' | 'alt' | 'ctrl';
export type Position = 'auto' | 'left' | 'right';
export type Background = 'dark' | 'light' | 'blur';

export interface HoverZoomSettings {
	enabled: boolean;
	trigger: TriggerMode;
	delay: number;
	maxSize: number;
	antiHotlink: boolean;
	position: Position;
	background: Background;
}

export const DEFAULT_SETTINGS: HoverZoomSettings = {
	enabled: true,
	trigger: 'hover',
	delay: 200,
	maxSize: 800,
	antiHotlink: true,
	position: 'auto',
	background: 'dark',
};

export const STORAGE_KEY = 'halo_hover_zoom_settings';

// Domains requiring anti-hotlink (Referer removal)
export const HOTLINK_DOMAINS = [
	'*.bilibili.com',
	'*.hdslb.com',
	'*.weibo.com',
	'*.sinaimg.cn',
	'*.zhimg.com',
	'*.zhihu.com',
	'*.douban.com',
	'*.doubanio.com',
];
