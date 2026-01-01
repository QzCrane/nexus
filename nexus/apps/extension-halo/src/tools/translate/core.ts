// goal: Translate core logic

export function getTranslateUrl(engine: 'google' | 'deepl' | 'bing', url: string, targetLang = 'zh-CN'): string {
	const encoded = encodeURIComponent(url);
	switch (engine) {
		case 'google':
			return `https://translate.google.com/translate?sl=auto&tl=${targetLang}&u=${encoded}`;
		case 'bing':
			return `https://www.translatetheweb.com/?from=&to=${targetLang}&a=${encoded}`;
		// DeepL doesn't support full page translate via URL nicely for free users without extension, 
		// but we can try their website wrapper if available, or just text.
		// For page, mainly Google/Bing.
		default:
			return `https://translate.google.com/translate?sl=auto&tl=${targetLang}&u=${encoded}`;
	}
}

export function openTranslation(engine: 'google' | 'deepl' | 'bing', text?: string, targetLang = 'zh-CN') {
	if (text) {
		const encoded = encodeURIComponent(text);
		let url = '';
		if (engine === 'google') url = `https://translate.google.com/?sl=auto&tl=${targetLang}&text=${encoded}&op=translate`;
		else if (engine === 'deepl') url = `https://www.deepl.com/translator#auto/${targetLang}/${encoded}`;
		else if (engine === 'bing') url = `https://www.bing.com/translator?from=auto&to=${targetLang}&text=${encoded}`;

		window.open(url, '_blank');
	} else {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const url = tabs[0]?.url;
			if (url && (url.startsWith('http') || url.startsWith('https'))) {
				window.open(getTranslateUrl(engine, url, targetLang), '_blank');
			}
		});
	}
}
