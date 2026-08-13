// goal: one Hover Zoom persisted-settings parser shared by every runtime realm
// inv: nested settings are completed from the product defaults in one place

import {
	DEFAULT_SETTINGS,
	type HoverZoomSettings,
} from './types';

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function booleanValue(value: unknown, fallback: boolean, failClosed = false): boolean {
	if (value === undefined) return fallback;
	return typeof value === 'boolean' ? value : failClosed ? false : fallback;
}

function numberValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
		? value
		: fallback;
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
	return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function stringValue(value: unknown, fallback: string, maximumLength: number): string {
	return typeof value === 'string' && value.length <= maximumLength ? value : fallback;
}

function stringArray(value: unknown, fallback: readonly string[]): string[] {
	return Array.isArray(value)
		&& value.length <= 1_000
		&& value.every((item) => typeof item === 'string' && item.length <= 2_048)
		? [...value]
		: [...fallback];
}

function keyCombo(value: unknown, fallback: HoverZoomSettings['resourceKeys']['imageKey']) {
	const candidate = record(value);
	const disabled = candidate.disabled === undefined
		? fallback.disabled
		: typeof candidate.disabled === 'boolean' ? candidate.disabled : fallback.disabled;
	return {
		shift: booleanValue(candidate.shift, fallback.shift),
		ctrl: booleanValue(candidate.ctrl, fallback.ctrl),
		alt: booleanValue(candidate.alt, fallback.alt),
		...(disabled === undefined ? {} : { disabled }),
	};
}

export function parseHoverZoomSettings(value: unknown): HoverZoomSettings {
	const saved = record(value);
	const resources = record(saved.resourceKeys);
	const exemptions = record(saved.exemptions);
	const info = record(saved.imageInfoItems);
	return {
		enabled: booleanValue(saved.enabled, DEFAULT_SETTINGS.enabled, true),
		triggerKey: enumValue(saved.triggerKey, DEFAULT_SETTINGS.triggerKey, ['none', 'shift', 'ctrl', 'alt']),
		triggerAction: enumValue(saved.triggerAction, DEFAULT_SETTINGS.triggerAction, ['hold', 'toggle']),
		triggerDelay: numberValue(saved.triggerDelay, DEFAULT_SETTINGS.triggerDelay, 0, 60_000),
		autoCloseDelay: numberValue(saved.autoCloseDelay, DEFAULT_SETTINGS.autoCloseDelay, 0, 60_000),
		resourceKeys: {
			imageKey: keyCombo(resources.imageKey, DEFAULT_SETTINGS.resourceKeys.imageKey),
			videoKey: keyCombo(resources.videoKey, DEFAULT_SETTINGS.resourceKeys.videoKey),
		},
		altKeyMode: enumValue(saved.altKeyMode, DEFAULT_SETTINGS.altKeyMode, ['block', 'compat']),
		viewMode: enumValue(saved.viewMode, DEFAULT_SETTINGS.viewMode, ['fit', 'original']),
		position: enumValue(saved.position, DEFAULT_SETTINGS.position, ['auto', 'top', 'bottom', 'left', 'right', 'center']),
		background: enumValue(saved.background, DEFAULT_SETTINGS.background, ['dark', 'light', 'blur', 'page', 'system']),
		showImageInfo: enumValue(saved.showImageInfo, DEFAULT_SETTINGS.showImageInfo, ['none', 'top', 'bottom']),
		showLoadingIndicator: booleanValue(saved.showLoadingIndicator, DEFAULT_SETTINGS.showLoadingIndicator),
		highlightMode: enumValue(saved.highlightMode, DEFAULT_SETTINGS.highlightMode, ['always', 'hotkey', 'off']),
		borderRadius: numberValue(saved.borderRadius, DEFAULT_SETTINGS.borderRadius, 0, 100),
		imageInfoItems: {
			typeIcon: booleanValue(info.typeIcon, DEFAULT_SETTINGS.imageInfoItems.typeIcon),
			dimensions: booleanValue(info.dimensions, DEFAULT_SETTINGS.imageInfoItems.dimensions),
			ratio: booleanValue(info.ratio, DEFAULT_SETTINGS.imageInfoItems.ratio),
			scale: booleanValue(info.scale, DEFAULT_SETTINGS.imageInfoItems.scale),
			format: booleanValue(info.format, DEFAULT_SETTINGS.imageInfoItems.format),
			size: booleanValue(info.size, DEFAULT_SETTINGS.imageInfoItems.size),
			caption: booleanValue(info.caption, DEFAULT_SETTINGS.imageInfoItems.caption),
			source: booleanValue(info.source, DEFAULT_SETTINGS.imageInfoItems.source),
			hostname: booleanValue(info.hostname, DEFAULT_SETTINGS.imageInfoItems.hostname),
		},
		exemptions: {
			maxViewportCoverage: numberValue(exemptions.maxViewportCoverage, DEFAULT_SETTINGS.exemptions.maxViewportCoverage, 0, 1),
			maxWidthCoverage: numberValue(exemptions.maxWidthCoverage, DEFAULT_SETTINGS.exemptions.maxWidthCoverage, 0, 1),
			maxHeightCoverage: numberValue(exemptions.maxHeightCoverage, DEFAULT_SETTINGS.exemptions.maxHeightCoverage, 0, 1),
			smallInteractive: booleanValue(exemptions.smallInteractive, DEFAULT_SETTINGS.exemptions.smallInteractive),
			playingVideo: booleanValue(exemptions.playingVideo, DEFAULT_SETTINGS.exemptions.playingVideo),
		},
		antiHotlink: booleanValue(saved.antiHotlink, DEFAULT_SETTINGS.antiHotlink, true),
		enableAnimations: booleanValue(saved.enableAnimations, DEFAULT_SETTINGS.enableAnimations),
		downloadTemplate: stringValue(saved.downloadTemplate, DEFAULT_SETTINGS.downloadTemplate, 512),
		siteBlacklist: stringArray(saved.siteBlacklist, DEFAULT_SETTINGS.siteBlacklist),
		siteWhitelist: stringArray(saved.siteWhitelist, DEFAULT_SETTINGS.siteWhitelist),
		whiteListMode: booleanValue(saved.whiteListMode, DEFAULT_SETTINGS.whiteListMode),
		videoFallbackToImage: booleanValue(saved.videoFallbackToImage, DEFAULT_SETTINGS.videoFallbackToImage),
		pinKey: stringValue(saved.pinKey, DEFAULT_SETTINGS.pinKey, 32),
	};
}
