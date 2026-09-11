import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../src/tools/markdown/core';

// renderMarkdown is the pure marked adapter. The sanitizing half of the
// pipeline (parseMarkdown) binds to the ambient DOM and its hostile-input
// boundary is verified in the real-browser lane (test:playwright), because a
// synthetic DOM does not faithfully resolve the sanitizer's template parsing.

describe('Markdown engine adapter (marked)', () => {
	test('fenced code keeps literal emphasis characters as content', () => {
		const html = renderMarkdown('```\n**literal** not strong\n```\n');
		expect(html).toContain('<pre><code');
		expect(html).toContain('**literal** not strong');
		expect(html).not.toContain('<strong>literal</strong>');
	});

	test('blockquotes become real elements with paragraph content', () => {
		const html = renderMarkdown('> quoted text\n');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('quoted text');
	});

	test('inline emphasis, links and task lists render as elements', () => {
		const html = renderMarkdown('**bold** and [link](https://example.test)\n\n- [x] done');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('href="https://example.test"');
		expect(html).toContain('done');
	});
});
