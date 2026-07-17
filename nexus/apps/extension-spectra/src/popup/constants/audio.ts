// goal: defines visual and interaction bounds for audio parameters within the popup UI

export const AUDIO_UI = {
  // Main volume mirrors the page-native HTML/player scale exactly.
  MAIN_VOLUME_MAX: 100,
  MAIN_VOLUME_STEP: 10,
  // Boost is a separate processor capability and never changes page volume.
  BOOST_MIN: 1,
  BOOST_MAX: 8,
  BOOST_STEP: 0.1,
  // EQ_MIN/MAX: decibel range for the graphic equalizer UI
  EQ_MIN: -12,
  EQ_MAX: 12,
  EQ_STEP: 0.1,
} as const;
