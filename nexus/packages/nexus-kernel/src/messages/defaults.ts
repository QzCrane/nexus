// goal: defines runtime default values for audio and global configurations

import type { GlobalSettings } from '@nexus/contracts';

export { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  osdEnabled: true,
  visualizerEnabled: true,
  lang: 'en-US',
  themeMode: 'system',
  pauseRetentionSeconds: 60
};
