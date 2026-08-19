import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('SPECTRA shared accessibility ownership', () => {
	test('Popup and Options both install the same accessibility policy before readiness', () => {
		for (const entry of ['src/popup/index.ts', 'src/options/index.ts']) {
			const text = source(entry);
			expect(text, entry).toContain("import { installAccessibilityPolicy } from '../shared/accessibility'");
			expect(text, entry).toContain('await installAccessibilityPolicy();');
			expect(text, entry).toContain("document.documentElement.dataset.spectraReady = 'true'");
			expect(text.indexOf('await installAccessibilityPolicy();'), entry)
				.toBeLessThan(text.indexOf("dataset.spectraReady = 'true'"));
		}
	});

	test('reduced motion controls the custom scroll engine dynamically', () => {
		const text = source('src/shared/smooth-scroll.ts');
		expect(text).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
		expect(text).toContain("query.addEventListener('change', binding.onPreferenceChange)");
		expect(text).toContain('detachWheel(root, binding);');
		expect(text).toContain('cancelPendingScroll();');
		expect(text).toContain('query.removeEventListener');
	});

	test('one policy asset owns focus, reduced motion, contrast and narrow reflow', () => {
		const text = source('public/accessibility.css');
		expect(text).toContain(':focus-visible');
		expect(text).toContain('@media (prefers-reduced-motion: reduce)');
		expect(text).toContain('animation-duration: 0.001ms !important');
		expect(text).toContain('transition-duration: 0.001ms !important');
		expect(text).toContain('@media (max-width: 389px)');
		expect(text).toContain('--text-muted: #8f8f8f');
		expect(text).toContain('--text-muted: #666666');
	});
});
