import { describe, expect, test } from 'bun:test';
import { THEME_SURFACES } from '../src/kernel/core/theme-palette';

function luminance(hex: string): number {
	const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
	const [r = 0, g = 0, b = 0] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
describe('shared theme text contrast', () => {
	for (const [name, palette] of Object.entries(THEME_SURFACES)) test(name, () => {
		for (const text of [palette.text, palette.textSecondary, palette.textMuted]) {
			for (const surface of [palette.bg, palette.bgSecondary, palette.bgTertiary]) {
				const a = luminance(text); const b = luminance(surface);
				expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
});
