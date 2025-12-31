// goal: Reader Mode type definitions

export interface ReaderConfig {
	fontSize: number;
	lineHeight: number;
	maxWidth: number;
	theme: 'light' | 'sepia' | 'dark';
	fontFamily: string;
}

export interface ArticleContent {
	title: string;
	content: string;
	textContent: string;
	siteName: string;
	byline: string;
}
