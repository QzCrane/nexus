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
		expect(text).toContain('attachWheel(root, binding);');
		expect(text).toContain('query.removeEventListener');
	});

	test('one policy asset owns focus, reduced motion, rendered muted contrast and narrow reflow', () => {
		const text = source('public/accessibility.css');
		expect(text).toContain('@layer spectra-product, spectra-accessibility');
		expect(text).not.toContain('!important');
		for (const product of ['popup.css', 'options.css']) expect(source(`public/${product}`)).toContain('@layer spectra-product');
		expect(text).toContain(':focus-visible');
		expect(text).toContain('@media (prefers-reduced-motion: reduce)');
		expect(text).toContain('animation-duration: 0.001ms');
		expect(text).toContain('transition-duration: 0.001ms');
		expect(text).toContain('@media (max-width: 389px)');
		expect(text).toContain('--text-muted: #8f8f8f');
		expect(text).toContain('--text-muted: #666666');
		expect(text).toContain('input::placeholder');
		expect(text).toContain('textarea::placeholder');
		expect(text).toContain('opacity: 1;');
	});

	test('installed-browser evidence covers both motion transitions and real muted rendering', () => {
		const text = source('test/accessibility-chrome.spec.ts');
		expect(text).toContain('pending rAF is cancelled under reduced motion');
		expect(text).toContain('reduced-motion wheel pass-through');
		expect(text).toContain('restored smooth-scroll owner');
		expect(text).toContain("document.querySelector<HTMLElement>('.section-desc')");
		expect(text).toContain("getComputedStyle(input, '::placeholder')");
	});
});
