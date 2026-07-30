import { describe, expect, test } from 'bun:test';
import { parseMarkdown } from '../src/tools/markdown/core';

describe('Markdown preview HTML boundary', () => {
	test('escapes raw HTML and event-handler payloads before adding Markdown markup', () => {
		const html = parseMarkdown(
			'<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n**safe**',
		);

		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img src=x');
		expect(html).not.toMatch(/\son\w+=/iu);
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('<strong>safe</strong>');
	});

	test('rejects executable URL schemes and closes attribute-injection attempts', () => {
		const html = parseMarkdown(
			'[bad](javascript:alert(1))\n![alt](https://example.test/x" onerror="alert(2))',
		);

		expect(html).not.toContain('javascript:');
		expect(html).not.toMatch(/\son\w+=/iu);
		expect(html).toContain('href="#"');
		expect(html).toContain('&quot;');
	});

	test('keeps explicitly allowed link and image schemes', () => {
		const html = parseMarkdown(
			'[web](https://example.test/docs)\n![pixel](data:image/png;base64,AA==)',
		);

		expect(html).toContain('href="https://example.test/docs"');
		expect(html).toContain('src="data:image/png;base64,AA=="');
	});
});
