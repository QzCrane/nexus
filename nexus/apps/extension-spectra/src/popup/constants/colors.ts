/**
 * SPECTRA Popup - Color Constants
 */

import { UIColors } from '@nexus/audio-engine';

/** UI Color Definitions (imported from @nexus/audio-engine) */
export const COLORS = UIColors;

/** EQ Curve Gradients */
export const EQ_GRADIENT = {
  TOP: 'rgba(37, 99, 235, 0.25)',
  BOTTOM: 'rgba(37, 99, 235, 0.0)',
  SHADOW: 'rgba(37, 99, 235, 0.5)',
  STROKE: '#2563eb',
} as const;

export type ColorKey = keyof typeof COLORS;
