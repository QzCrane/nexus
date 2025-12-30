// goal: Smooth Scroll module entry point

export { SmoothScrollPanel } from './panel';
export type { ScrollSettings } from './types';
export { DEFAULT_SETTINGS, STORAGE_KEY } from './types';
export { loadSettings, saveSettings, broadcastSettings } from './core';
