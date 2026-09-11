// goal: Markdown adapter over marked + DOMPurify (R11/R12)
// rule: the maintained engines own markdown parsing and final HTML sanitizing.
// renderMarkdown is a pure marked adapter; parseMarkdown adds the DOM-bound
// sanitizing pass and is the sidepanel entry. Sanitizer semantics are verified
// in the browser lane, not in a synthetic DOM.

import { marked } from 'marked';

/**
 * Parse Markdown to HTML with the marked engine. Output is NOT yet sanitized.
 */
export function renderMarkdown(md: string): string {
	const raw = marked.parse(md, { async: false });
	return typeof raw === 'string' ? raw : '';
}

/**
 * Parse and sanitize in one call for the sidepanel preview. Requires a DOM
 * realm: a realm that cannot sanitize must not pretend it did.
 */
export async function parseMarkdown(md: string): Promise<string> {
	const html = renderMarkdown(md);
	const DOMPurify = (await import('dompurify')).default;
	if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') {
		throw new Error('Markdown sanitization requires a DOM environment');
	}
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		// Explicit denylist on top of the profile: some non-browser DOM
		// implementations resolve template parsing permissively.
		FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form'],
		FORBID_ATTR: ['srcdoc'],
		// Links open detached from the sidepanel document.
		ADD_ATTR: ['target', 'rel'],
		// Keep the tool's embedded-image feature: data:image/* URIs stay, other
		// data: payloads (data:text/html and friends) are stripped.
		ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data:image\/):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
	});
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
