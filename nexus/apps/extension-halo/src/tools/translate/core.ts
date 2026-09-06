// goal: Translate core logic
// rule: the engine the user selects is the receiver the request goes to. A
// chosen engine that cannot serve the requested mode fails explicitly instead
// of being silently substituted with another provider.

export type TranslateEngine = 'google' | 'deepl' | 'bing';

export function getTranslateUrl(engine: TranslateEngine, url: string, targetLang = 'zh-CN'): string {
	const encoded = encodeURIComponent(url);
	switch (engine) {
		case 'google':
			return `https://translate.google.com/translate?sl=auto&tl=${targetLang}&u=${encoded}`;
		case 'bing':
			return `https://www.translatetheweb.com/?from=&to=${targetLang}&a=${encoded}`;
		case 'deepl':
			// DeepL has no URL-based full-page translation; silently handing the
			// page to another provider is not acceptable.
			throw new Error('DeepL does not offer full-page translation by URL. Use Google or Bing for this page, or paste the text instead.');
		default: {
			const never: never = engine;
			throw new Error(`Unknown translation engine: ${String(never)}`);
		}
	}
}

export function openTranslation(engine: TranslateEngine, text?: string, targetLang = 'zh-CN') {
	if (text) {
		const encoded = encodeURIComponent(text);
		let url = '';
		if (engine === 'google') url = `https://translate.google.com/?sl=auto&tl=${targetLang}&text=${encoded}&op=translate`;
		else if (engine === 'deepl') url = `https://www.deepl.com/translator#auto/${targetLang}/${encoded}`;
		else if (engine === 'bing') url = `https://www.bing.com/translator?from=auto&to=${targetLang}&text=${encoded}`;
		else {
			const never: never = engine;
			throw new Error(`Unknown translation engine: ${String(never)}`);
		}

		if (url) window.open(url, '_blank');
	} else {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const url = tabs[0]?.url;
			if (url && (url.startsWith('http') || url.startsWith('https'))) {
				window.open(getTranslateUrl(engine, url, targetLang), '_blank');
			}
		});
	}
}
