/**
 * SPECTRA Popup - Timing & UI Constants
 */

/** Timing Constants (ms) */
export const TIMING = {
  /** Capture Init Delay */
  CAPTURE_INIT_DELAY: 300,
  /** Visualizer Frame Interval (~30 FPS) */
  VIZ_FRAME_INTERVAL: 32,
  /** Delay before updating metrics after EQ drawer animation */
  EQ_DRAWER_DELAY: 310,
  /** MetricsCache Init Loops */
  METRICS_INIT_LOOPS: 20,
  BUTTON_FEEDBACK_DURATION: 1000,
} as const;

/** UI Size Constants (px) */
export const UI_SIZES = {
  /** Settings Min Height */
  SETTINGS_MIN_HEIGHT: 480,
  VIZ_BAR_WIDTH: 3,
  VIZ_BAR_GAP: 1,
  EQ_CURVE_LINE_WIDTH: 2.5,
  EQ_CURVE_SHADOW_BLUR: 8,
} as const;

/** Visualizer Params */
export const VIZ_PARAMS = {
  HEIGHT_FACTOR: 0.9,
  MIN_VISIBLE_HEIGHT: 1,
} as const;
