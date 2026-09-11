// goal: Markdown panel UI - split view editor with live preview

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { parseMarkdown, getPreviewStyles } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


type ViewMode = 'split' | 'edit' | 'preview';

const SAMPLE_MD = `# Markdown Preview

## Features

- **Bold** and *italic* text
- ~~Strikethrough~~
- \`inline code\`

### Code Block

\`\`\`javascript
function hello() {
  console.log('Hello!');
}
\`\`\`

> Blockquote example

1. Ordered list
2. Second item

- [x] Task completed
- [ ] Task pending

[Link](https://example.com)
`;

export const MarkdownPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('markdown', SAMPLE_MD);
	const [viewMode, setViewMode] = useToolState<ViewMode>('markdown-view', 'split');


	// Parse markdown to sanitized HTML (async: the sanitizing pass is DOM-bound)
	const [html, setHtml] = useState('');
	useEffect(() => {
		let alive = true;
		void parseMarkdown(input)
			.then((rendered) => { if (alive) setHtml(rendered); })
			.catch((renderError) => { if (alive) setHtml(`<p class="md-error">${String(renderError)}</p>`); });
		return () => { alive = false; };
	}, [input]);
	const previewStyles = useMemo(() => getPreviewStyles(), []);

	// Copy HTML
	const handleCopyHtml = useCallback(() => {
		navigator.clipboard.writeText(html);
	}, [html]);

	// Copy markdown
	const handleCopyMd = useCallback(() => {
		navigator.clipboard.writeText(input);
	}, [input]);

	return (
		<div style={styles.wrapper}>
			{/* View Mode Tabs */}
			<div style={styles.tabs}>
				{(['edit', 'split', 'preview'] as ViewMode[]).map((mode) => (
					<button type="button"
						key={mode}
						style={{ ...styles.tab, ...(viewMode === mode ? styles.active : styles.inactive) }}
						onClick={() => setViewMode(mode)}
					>
						{mode === 'edit' ? '✏️ ' : mode === 'preview' ? '👁️ ' : '⚡ '}{t(`markdown.${mode}`)}
					</button>
				))}
			</div>

			{/* Editor Area */}
			<div style={{ ...styles.editor, flexDirection: viewMode === 'split' ? 'row' : 'column' }}>
				{/* Markdown Input */}
				{viewMode !== 'preview' && (
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('markdown.placeholder')}
					/>
				)}

				{/* Preview */}
				{viewMode !== 'edit' && (
					<div style={styles.preview}>
						<style>{previewStyles}</style>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: the rendered string is DOMPurify output (R11/R12); the sanitizer is the hostile-input boundary and its semantics are verified in the browser lane. */}
						<div dangerouslySetInnerHTML={{ __html: html }} />
					</div>
				)}
			</div>

			{/* Actions */}
			<div style={styles.row}>
				<button type="button" style={styles.btn} onClick={handleCopyMd}>📋 {t('markdown.copyMd')}</button>
				<button type="button" style={styles.btn} onClick={handleCopyHtml}>🔗 {t('markdown.copyHtml')}</button>
			</div>
		</div>
	);
};
