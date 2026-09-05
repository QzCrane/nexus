// goal: aggregation point for all functional message handlers in the background service worker

export { registerAudioHandlers } from './audio';
export { registerSettingsHandlers } from './settings';
export { registerCaptureHandlers, handleCaptureToggle } from './capture';
export { registerHotkeyTargetHandlers } from './hotkey-target';
export { registerRegistryHandlers } from './registry';
export { registerTabStateHandlers } from './tab-state';
export { registerScreenshotHandler } from './screenshot';
