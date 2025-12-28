// goal: dark mode engine using CSS filter + SVG matrix for lightweight page inversion

const SVG_ID = 'nexus-dark-mode-svg';
const FILTER_ID = 'nexus-dark-mode-filter';
const STYLE_ID = 'nexus-dark-mode-style';

// Smart inversion matrix (preserves color perception while inverting luminance)
const MATRIX_VALUES = `
0.2126 -0.7152 -0.0722 0.0000 1.0000 
-0.2126 0.2848 -0.0722 0.0000 1.0000 
-0.2126 -0.7152 0.9278 0.0000 1.0000 
0.0000 0.0000 0.0000 1.0000 0.0000
`;

export interface DarkModeConfig {
	// CSS to inject for dark mode
	css?: string;
	// Selectors to exclude from inversion (media elements)
	excludeSelectors?: string[];
}

const DEFAULT_EXCLUDE = [
	'img', 'video', 'iframe', 'canvas', 'svg',
	'[style*="background-image"]',
	'.ytp-cued-thumbnail-overlay-image',
	'.ytd-thumbnail'
];

const DEFAULT_CSS = `
html {
	filter: url('#${FILTER_ID}') !important;
	background-color: #111 !important;
}

::-webkit-scrollbar { background-color: #202020 !important; width: 12px !important; }
::-webkit-scrollbar-track { background-color: #202020 !important; }
::-webkit-scrollbar-thumb { background-color: #444 !important; border-radius: 6px !important; border: 2px solid #202020 !important; }
`;

function buildExcludeCSS(selectors: string[]): string {
	return `${selectors.join(',\n')} {\n  filter: none !important;\n}`;
}

function injectSvgFilter(): void {
	if (document.getElementById(SVG_ID)) return;

	const div = document.createElement('div');
	div.id = SVG_ID;
	div.style.cssText = 'height: 0; overflow: hidden; position: fixed; top: 0; left: 0; pointer-events: none; z-index: -9999;';

	div.innerHTML = `
		<svg xmlns="http://www.w3.org/2000/svg">
			<filter id="${FILTER_ID}">
				<feColorMatrix type="matrix" values="${MATRIX_VALUES}" />
			</filter>
		</svg>
	`;

	(document.body || document.documentElement).appendChild(div);
}

function injectStyle(css: string): void {
	if (document.getElementById(STYLE_ID)) return;

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = css;

	const target = document.head || document.documentElement;
	if (target) {
		target.appendChild(style);
	}
}

export function enableDarkMode(config: DarkModeConfig = {}): void {
	const excludeSelectors = config.excludeSelectors ?? DEFAULT_EXCLUDE;
	const css = (config.css ?? DEFAULT_CSS) + '\n' + buildExcludeCSS(excludeSelectors);

	injectSvgFilter();
	injectStyle(css);
	console.log('[ZEN] Dark Mode enabled');
}

export function disableDarkMode(): void {
	const style = document.getElementById(STYLE_ID);
	if (style) style.remove();

	const svg = document.getElementById(SVG_ID);
	if (svg) svg.remove();

	if (style || svg) console.log('[ZEN] Dark Mode disabled');
}

export function isDarkModeEnabled(): boolean {
	return !!document.getElementById(STYLE_ID);
}

export function toggleDarkMode(config?: DarkModeConfig): boolean {
	if (isDarkModeEnabled()) {
		disableDarkMode();
		return false;
	} else {
		enableDarkMode(config);
		return true;
	}
}
