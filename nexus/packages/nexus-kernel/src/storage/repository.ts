// goal: type-safe storage repository providing unified access to split storage modules
// note: exposes acknowledged tab-session projections

import * as tabSessionModule from './tab-session.js';

export class StorageRepository {
  // Acknowledged control session (resource observations + origin-portable intent, isolated per tab)
  tabSession = {
	identity: tabSessionModule.createTabControlSessionIdentity,
    get: tabSessionModule.getTabControlSession,
    merge: tabSessionModule.mergeTabControlSession,
	rebind: tabSessionModule.rebindTabControlSession,
    remove: tabSessionModule.removeTabControlSession,
	flush: tabSessionModule.flushTabControlSession,
    has: tabSessionModule.hasTabControlSession,
  };

  // Cross-tab same-origin baseline: origin-portable adjustments union-merged
  // across every tab on an origin so a fresh same-origin tab inherits them.
  originSession = {
	merge: tabSessionModule.mergeOriginControlSession,
	get: tabSessionModule.getOriginControlSession,
	remove: tabSessionModule.removeOriginControlSession,
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
