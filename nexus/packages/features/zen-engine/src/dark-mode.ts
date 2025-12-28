// goal: best-in-class dark mode with smart background protection
// engine: "Zen Hybrid V6" -> CSS Filters + Micro-JS Protection Observer
// key-feature: detects css-background-images efficiently and protects them from inversion
// fix: improved selectors for Bilibili player to prevent video inversion and white controls

const STYLE_ID = 'zen-dark-mode-style';
const PROTECT_CLASS = 'zen-smart-protect';

export interface DarkModeConfig {
	brightness?: number;
	contrast?: number;
	sepia?: number;
	grayscale?: number;
	enablePerfLog?: boolean;
}

// 1. Elements that are NATURALLY media and should always be reverted
// Added 'canvas' and specific Bilibili image classes to be safe
const NATIVE_PROTECTED_SELECTORS = [
	'img', 'video', 'canvas', 'svg',
	'embed', 'object',
	'iframe', // iframes handle their own darkening usually
	'.bili-avatar',
	'.bili-video-card__cover',
	'.bpx-player-video-area', // Bilibili player video area specifically
	'.bpx-player-video-wrap',
	'.bilibili-player-video',
	'.video-content'
].join(', ');

// 2. CSS Generator
function generateCSS(config: DarkModeConfig): string {
	const { brightness = 100, contrast = 100, sepia = 10 } = config;

	// The Inversion Matrix
	const filterAction = `invert(100%) hue-rotate(180deg) brightness(${brightness}%) contrast(${contrast}%) sepia(${sepia}%)`;
	// The Restoration Matrix (exact opposite)
	const revertAction = `invert(100%) hue-rotate(180deg)`;

	return `
/* === ZEN HYBRID ENGINE V6 === */

html {
	background-color: #f0f0f0 !important;
	filter: ${filterAction} !important;
	height: 100%;
}

/* Fix Fullscreen */
:fullscreen, :fullscreen * {
	filter: none !important;
}

/* === SMART PROTECTION SYSTEM === */

/* Level 1: Native Media Tags (Always Protect) */
${NATIVE_PROTECTED_SELECTORS} {
	filter: ${revertAction} !important;
	opacity: 0.95;
	transition: opacity 0.3s;
}

/* Level 2: Smart JS-Detected Backgrounds */
/* Elements marked by our JS observer as having background-images */
.${PROTECT_CLASS} {
	filter: ${revertAction} !important;
}

/* Level 3: Hardcoded Exclusions (Bilibili Specifics) */
/* Player Container: We protect the WHOLE container to keep danmaku/controls correct */
/* We target multiple possible container levels to ensure we catch it */
#bilibili-player,
#bilibiliPlayer,
#player_module,
.bpx-player-container,
.player-container,
.bilibili-player-video-wrap,
#movie_player {
	filter: ${revertAction} !important;
	background-color: #000 !important; /* Ensure black bg behind video */
}

/* Fix for White Progress Bar / Controls */
/* Since the container is reverted (Normal Light Mode), and Light Mode controls are black, they should be black. */
/* If they are white, it means the container exclusion FAILED. */
/* We force controls to be dark just in case */
.bpx-player-control-bottom,
.bpx-player-control-wrap,
.bilibili-player-control {
    filter: none !important; /* Do not invert controls if they are already in a reverted container */
    background-color: transparent !important;
}

/* Inside the protect player, prevent double-reversion of video tag */
/* If container is NO-FILTER (via Revert), then video should contain NO-FILTER */
#bilibili-player video,
.bpx-player-container video,
.player-container video,
#bilibili-player img,
.bpx-player-container img {
	filter: none !important; /* It's already inside a reverted container */
}

/* Fix Bilibili Header/Footer Images often implemented as background-images */
.bili-header__banner,
.bili-header .cartoon,
.banner-img,
.bili-dyn-card-video__cover,
.b-img {
	filter: ${revertAction} !important;
}

/* === UI Tweaks === */
::selection {
	background-color: #004a9e !important;
	color: #fff !important;
}

/* Scrollbars */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: #222; }
::-webkit-scrollbar-thumb { background: #555; border: 2px solid #222; border-radius: 4px; }
`;
}

// === Micro-Observer for Background Images ===
// This solves the "CSS can't see background-images" problem
let observer: MutationObserver | null = null;
const processedNodes = new WeakSet<Element>();

// Efficiently check if an element has a background image
function checkAndProtect(el: Element) {
	if (processedNodes.has(el)) return;
	processedNodes.add(el);

	// Fast path: check inline style first
	let bg = el.getAttribute('style');
	if (bg && bg.includes('url(')) {
		el.classList.add(PROTECT_CLASS);
		return;
	}

	// Slower path: computed style (batched naturally by browser usually, but still heavy)
	// We only check elements that look like they might be containers or icons
	// Optimization: Skip purely text tags to save perf
	const tag = el.tagName;
	if (tag === 'P' || tag === 'SPAN' || tag === 'H1' || tag === 'H2' || tag === 'H3') return;

	// This is the heavy part, but necessary for "Perfect" results
	// We debounce it or limit it to visible elements in a real production engine
	// For now, we rely on the fact that 'getComputedStyle' is fast enough for modern PCs
	const style = window.getComputedStyle(el);
	if (style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
		el.classList.add(PROTECT_CLASS);
	}
}

function startObserver() {
	if (observer) return;

	// 1. Check existing nodes
	document.querySelectorAll('*').forEach(el => checkAndProtect(el));

	// 2. Observe new nodes
	observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type === 'childList') {
				m.addedNodes.forEach(node => {
					if (node.nodeType === 1) { // Element
						checkAndProtect(node as Element);
						// Deep check children if it's a structural update
						(node as Element).querySelectorAll('*').forEach(child => checkAndProtect(child));
					}
				});
			} else if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
				checkAndProtect(m.target as Element);
			}
		}
	});

	observer.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['style', 'class'] // Only re-check if visual props change
	});
}

function stopObserver() {
	observer?.disconnect();
	observer = null;
}

// === Runtime ===

export function enableDarkMode(config: DarkModeConfig = {}): void {
	if (document.getElementById(STYLE_ID)) return;

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = generateCSS(config);

	const target = document.head || document.documentElement;
	target.appendChild(style);
	document.documentElement.classList.add('zen-dark-mode');

	// Start the smart protector
	startObserver();
}

export function disableDarkMode(): void {
	const style = document.getElementById(STYLE_ID);
	if (style) style.remove();
	document.documentElement.classList.remove('zen-dark-mode');

	stopObserver();
}

export function isDarkModeEnabled(): boolean {
	return !!document.getElementById(STYLE_ID);
}

export function toggleDarkMode(config?: DarkModeConfig): boolean {
	if (isDarkModeEnabled()) {
		disableDarkMode();
		return false;
	}
	enableDarkMode(config);
	return true;
}

export const DARK_MODE_PRESETS = {
	default: { brightness: 100, contrast: 100, sepia: 10 },
	highContrast: { brightness: 100, contrast: 120, sepia: 0 },
};

export type DarkModePreset = keyof typeof DARK_MODE_PRESETS;
