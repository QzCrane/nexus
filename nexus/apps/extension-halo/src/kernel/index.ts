// goal: HALO kernel re-exports (organized)
export * from './core/types';
export * from './core/storage';
export * from './core/settings';
export * from './core/theme';
export * from './core/resource-types';

export * from './registry/module-registry';
// export * from './registry/tool-registry'; // ToolMeta collision with module-registry
export { TOOL_REGISTRY, getToolMeta, type ToolMeta, type PluginMeta, type ModuleMeta, type ToolPrefs } from './registry/tool-registry';

export * from './managers/resource-manager';
export * from './managers/module-manager';
export * from './managers/remote-registry';

export * from './hooks/use-module-manager';
export * from './hooks/use-tool-manager';
export * from './hooks/use-remote-registry';
export * from './hooks/use-permission';
export * from './hooks/use-tool-state';
export * from './hooks/use-user-scripts';
export * from './hooks/use-settings';
export * from './hooks/use-owned-clipboard-copy';

export * from './services/saat-service';

export * from './utils/resource-utils';
export * from './utils/tool-search-utils';
export * from './utils/tool-storage-utils';
export * from './utils/pop-out-window';
export * from './utils/unified-search';
export * from './utils/completion-tone';
export * from './utils/serialized-async-poller';

