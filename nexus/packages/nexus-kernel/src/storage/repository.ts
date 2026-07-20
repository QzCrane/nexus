// goal: type-safe storage repository providing unified access to split storage modules
// note: acts as a compatibility layer for the site route registry and tab session config

import * as restrictedRegistry from './restricted-registry.js';
import * as tabSessionModule from './tab-session.js';

export class StorageRepository {
  // Restricted domain registry (v3.0+)
  registry = {
    init: restrictedRegistry.initRegistry,
    get: restrictedRegistry.getRegistry,
    query: restrictedRegistry.queryDomain,
    isRestricted: restrictedRegistry.isRestricted,
    add: restrictedRegistry.addDomain,
    remove: restrictedRegistry.removeDomain,
    markProbed: restrictedRegistry.markProbed,
    getDomainList: restrictedRegistry.getDomainList,
    set: restrictedRegistry.setRegistry,
  };

  // Tab session config (persists across refresh, isolated per tab)
  tabSession = {
    get: tabSessionModule.getTabSessionConfig,
    set: tabSessionModule.setTabSessionConfig,
    remove: tabSessionModule.removeTabSessionConfig,
	flush: tabSessionModule.flushTabSessionConfig,
    has: tabSessionModule.hasTabSessionConfig,
  };

  // eff: subscribes to 'local' storage area changes
  onChanged(callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') callback(changes);
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
    return () => { };
  }
}
