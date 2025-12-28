/**
 * SPECTRA Popup - Audio Constants
 *
 * Imported from @nexus/audio-engine where possible. Popup-specific constants defined here.
 */

/** Popup UI Specific Audio Constants */
export const AUDIO_UI = {
  /** Max Volume (%) - Slider range */
  MAX_VOLUME: 800,
  /** Volume Step - Wheel adjustment */
  VOLUME_STEP: 10,
  /** EQ Min (dB) */
  EQ_MIN: -12,
  /** EQ Max (dB) */
  EQ_MAX: 12,
  /** EQ Step (dB) */
  EQ_STEP: 0.1,
} as const;

/** Default EQ Values (10 bands flat) */
export const DEFAULT_EQ_VALUES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
