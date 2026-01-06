// goal: Hover highlight overlay - shows outline around trigger element
// eff: Similar to Imagus Reborn's hover highlight feature

const HIGHLIGHT_STYLE = `
.halo-hz-highlight {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 2147483646;
    opacity: 0;
    top: 50vh;
    left: 50vw;
    width: 0px;
    height: 0px;
    padding: 0;
    margin: 0;
    transition: all .1s cubic-bezier(0, 1, 0.3, 1), opacity .1s ease-in;
    /* Default highlight style - like Imagus Reborn */
    padding: 1px;
    outline: rgb(255, 120, 120) dashed 2px;
    outline-offset: 1px;
    box-shadow: white 0px 0px 0px 2px;
    border-radius: 2px;
}
`;

let highlightEl: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;

/**
 * Create the highlight element if not exists
 */
function ensureHighlight(): HTMLDivElement {
	if (highlightEl) return highlightEl;

	// Inject style
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.textContent = HIGHLIGHT_STYLE;
		document.head.appendChild(styleEl);
	}

	// Create highlight element
	highlightEl = document.createElement('div');
	highlightEl.className = 'halo-hz-highlight';
	document.body.appendChild(highlightEl);

	return highlightEl;
}

/**
 * Show highlight around target element
 */
export function showHighlight(target: HTMLElement): void {
	const el = ensureHighlight();
	const rect = target.getBoundingClientRect();
	const scrollX = window.scrollX;
	const scrollY = window.scrollY;

	el.style.left = `${rect.left + scrollX}px`;
	el.style.top = `${rect.top + scrollY}px`;
	el.style.width = `${rect.width}px`;
	el.style.height = `${rect.height}px`;
	el.style.opacity = '1';
}

/**
 * Hide highlight
 */
export function hideHighlight(): void {
	if (highlightEl) {
		highlightEl.style.opacity = '0';
	}
}

/**
 * Remove highlight element completely
 */
export function destroyHighlight(): void {
	if (highlightEl) {
		highlightEl.remove();
		highlightEl = null;
	}
	if (styleEl) {
		styleEl.remove();
		styleEl = null;
	}
}
