import { useState, useEffect } from 'react';
import type { ToolId } from '../core/types';

/**
 * goal: Detect high-intent content in clipboard and suggest a matching tool
 * logic: URL -> url-tools/devtools, Color -> color-picker, JSON -> json-formatter, etc.
 */
export function useClipboardIntent() {
	const [intent, setIntent] = useState<ToolId | null>(null);

	useEffect(() => {
		const checkClipboard = async () => {
			try {
				const text = await navigator.clipboard.readText();
				if (!text) return;

				// 1. JSON
				if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
					try {
						JSON.parse(text);
						setIntent('json-formatter' as ToolId);
						return;
					} catch { /* not valid json */ }
				}

				// 2. URL
				if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(text)) {
					setIntent('url' as ToolId);
					return;
				}

				// 3. Color
				if (/^#?([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(text) || /^rgb/i.test(text)) {
					setIntent('color-picker' as ToolId);
					return;
				}

				// 4. Base64
				if (text.length > 20 && /^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
					setIntent('base64' as ToolId);
					return;
				}

				// 5. JWT
				if (text.split('.').length === 3 && text.startsWith('eyJ')) {
					setIntent('jwt-decoder' as ToolId);
					return;
				}

			} catch (err) {
				// Clipboard access might be denied
			}
		};

		checkClipboard();

		// Also check on window focus
		window.addEventListener('focus', checkClipboard);
		return () => window.removeEventListener('focus', checkClipboard);
	}, []);

	return intent;
}
