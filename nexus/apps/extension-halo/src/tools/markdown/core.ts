// goal: Markdown core logic - simple markdown to HTML parser (no external deps)

// rule: panel.tsx renders parseMarkdown output via dangerouslySetInnerHTML in the
// sidepanel context which has chrome.storage access. Although parseMarkdown escapes
// raw HTML up front, sanitize the final HTML to strip any <script>/on*/javascript:
// sequences a future parser change or an edge case might reintroduce.
function sanitizeHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
		.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
		.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
		.replace(/javascript:/gi, '');
}

// Simple Markdown parser - handles common syntax
export function parseMarkdown(md: string): string {
	let html = md;

	// Escape HTML
	html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	// Code blocks (fenced)
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
		return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
	});

	// Inline code
	html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

	// Headers (after code blocks to avoid conflicts)
	html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

	// Horizontal rule
	html = html.replace(/^[-*_]{3,}$/gm, '<hr />');

	// Bold and italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
	html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
	html = html.replace(/_(.+?)_/g, '<em>$1</em>');

	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

	// Links and images — rule: validate URL scheme before substitution; reject
	// javascript:/vbscript:/data:text/html which would execute on click or load.
	const SAFE_URL = (url: string): string => {
		const trimmed = url.trim();
		if (/^(https?:|mailto:|data:image\/|\/|\.\/|\.\.\/|#|tel:)/i.test(trimmed)) return trimmed;
		return '#';
	};
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
		`<img src="${SAFE_URL(url)}" alt="${alt}" style="max-width:100%;" />`);
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
		`<a href="${SAFE_URL(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`);

	// Blockquotes
	html = html.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');
	// Merge consecutive blockquotes
	html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

	// Unordered lists
	html = html.replace(/^[-*+]\s+(.*)$/gm, '<li>$1</li>');

	// Ordered lists
	html = html.replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>');

	// Wrap consecutive <li> tags
	html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
		return `<ul>${match}</ul>`;
	});

	// Task lists
	html = html.replace(/<li>\[x\]\s*/gi, '<li>☑ ');
	html = html.replace(/<li>\[\s?\]\s*/g, '<li>☐ ');

	// Tables (basic)
	html = html.replace(/^\|(.+)\|$/gm, (_, content) => {
		const cells = content.split('|').map((c: string) => c.trim());
		const isHeader = cells.every((c: string) => /^[-:]+$/.test(c));
		if (isHeader) return ''; // Skip separator row
		const cellTag = 'td';
		return `<tr>${cells.map((c: string) => `<${cellTag}>${c}</${cellTag}>`).join('')}</tr>`;
	});
	html = html.replace(/(<tr>.*<\/tr>\n?)+/g, (match) => `<table>${match}</table>`);

	// Paragraphs - wrap remaining text blocks
	html = html.replace(/^(?!<[a-z]).+$/gm, (line) => {
		if (line.trim() === '') return '';
		return `<p>${line}</p>`;
	});

	// Clean up empty lines
	html = html.replace(/\n{3,}/g, '\n\n');

	// rule: defense-in-depth — strip <script>/on*/javascript: before returning HTML
	// that is rendered via dangerouslySetInnerHTML in the sidepanel context.
	return sanitizeHtml(html);
}

// Get preview styles
export function getPreviewStyles(): string {
	return `
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: var(--halo-text, #e0e0e0); padding: 12px; margin: 0; background: transparent; }
		h1, h2, h3, h4, h5, h6 { margin: 1em 0 0.5em; font-weight: 600; }
		h1 { font-size: 1.8em; border-bottom: 1px solid var(--halo-border, #333); padding-bottom: 0.3em; }
		h2 { font-size: 1.5em; }
		h3 { font-size: 1.25em; }
		p { margin: 0.5em 0; }
		code { background: var(--halo-bg-tertiary, #2a2a2a); padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 0.9em; }
		pre { background: var(--halo-bg-tertiary, #2a2a2a); padding: 12px; border-radius: 8px; overflow-x: auto; }
		pre code { background: none; padding: 0; }
		blockquote { border-left: 4px solid var(--halo-accent, #6366f1); margin: 0.5em 0; padding-left: 1em; color: var(--halo-text-muted, #888); }
		ul, ol { padding-left: 1.5em; margin: 0.5em 0; }
		li { margin: 0.25em 0; }
		a { color: var(--halo-accent, #6366f1); text-decoration: none; }
		a:hover { text-decoration: underline; }
		img { max-width: 100%; border-radius: 8px; }
		hr { border: none; border-top: 1px solid var(--halo-border, #333); margin: 1em 0; }
		table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
		td, th { border: 1px solid var(--halo-border, #333); padding: 8px 12px; text-align: left; }
		del { color: var(--halo-text-muted, #888); }
	`;
}
