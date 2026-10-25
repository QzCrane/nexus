// goal: centralizes visual theme tokens and canvas draw styles for the popup UI
// inv: CSS owns the live theme; the literals here are the no-document fallback

import { UI_COLORS } from '../../shared/ui-colors';

export const COLORS = UI_COLORS;

// eff: reads a live CSS custom property so painted pixels follow the active theme
// post: returns the fallback when the document or the property is unavailable
export function popupColorToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

let themedPrimaryTheme: string | null = null;
let themedPrimary: string | null = null;

// eff: resolves --primary once per rendered theme instead of once per animation frame
export function popupPrimaryColor(): string {
  if (typeof document === 'undefined') return COLORS.NATIVE;
  const theme = document.documentElement.dataset.theme ?? '';
  if (themedPrimary === null || themedPrimaryTheme !== theme) {
    themedPrimaryTheme = theme;
    themedPrimary = popupColorToken('--primary', COLORS.NATIVE);
  }
  return themedPrimary;
}

export type ColorKey = keyof typeof COLORS;
