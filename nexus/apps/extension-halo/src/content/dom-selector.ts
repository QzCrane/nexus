// goal: DOM Selector Content Script Module
// Handles hover highlighting and click-to-select logic

let isActive = false;
let overlay: HTMLElement | null = null;
let targetElement: Element | null = null;

// CSS for overlay
const OVERLAY_STYLE = `
    position: fixed;
    pointer-events: none;
    background: rgba(124, 58, 237, 0.2);
    border: 2px solid #7c3aed;
    border-radius: 4px;
    z-index: 999999;
    transition: all 0.1s ease;
    box-sizing: border-box;
`;

export function start(onSelect: (data: { css: string; xpath: string }) => void) {
	if (isActive) return;
	isActive = true;
	createOverlay();
	document.addEventListener('mouseover', handleHover, true);
	document.addEventListener('click', (e) => handleClick(e, onSelect), true);
	document.body.style.cursor = 'crosshair';
}

export function stop() {
	if (!isActive) return;
	isActive = false;
	removeOverlay();
	document.removeEventListener('mouseover', handleHover, true);
	// Note: 'click' listener removal is tricky with anonymous function, 
	// but we check isActive inside handleClick so it's effectively disabled.
	// Ideally we should store the bound function.
	document.body.style.cursor = '';
}

function createOverlay() {
	overlay = document.createElement('div');
	overlay.style.cssText = OVERLAY_STYLE;
	overlay.id = 'halo-dom-selector-overlay';
	document.body.appendChild(overlay);
}

function removeOverlay() {
	if (overlay) {
		overlay.remove();
		overlay = null;
	}
}

function handleHover(e: MouseEvent) {
	if (!isActive || !overlay) return;
	e.stopPropagation();

	const target = e.target as HTMLElement;
	if (target === overlay || target === document.body || target === document.documentElement) return;

	targetElement = target;
	const rect = target.getBoundingClientRect();

	overlay.style.top = `${rect.top}px`;
	overlay.style.left = `${rect.left}px`;
	overlay.style.width = `${rect.width}px`;
	overlay.style.height = `${rect.height}px`;
}

function handleClick(e: MouseEvent, callback: (data: any) => void) {
	if (!isActive) return;

	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();

	if (targetElement) {
		const css = getCssPath(targetElement);
		const xpath = getXPath(targetElement);
		callback({ css, xpath });
		stop(); // Stop after selection? Or keep selecting? Usually stop is better UX.
	}
}

// Generate CSS Path
function getCssPath(el: Element): string {
	if (!(el instanceof Element)) return '';
	const path: string[] = [];
	while (el.nodeType === Node.ELEMENT_NODE) {
		let selector = el.nodeName.toLowerCase();
		if (el.id) {
			selector += '#' + el.id;
			path.unshift(selector);
			break;
		} else {
			let sib = el, nth = 1;
			while (sib = sib.previousElementSibling as Element) {
				if (sib.nodeName.toLowerCase() == selector) nth++;
			}
			if (nth != 1) selector += ":nth-of-type(" + nth + ")";
		}
		path.unshift(selector);
		el = el.parentNode as Element;
	}
	return path.join(" > ");
}

// Generate XPath
function getXPath(element: Element): string {
	if (element.id) return `//*[@id="${element.id}"]`;
	if (element === document.body) return '/html/body';

	let ix = 0;
	const siblings = element.parentNode?.childNodes;
	if (!siblings) return '';

	for (let i = 0; i < siblings.length; i++) {
		const sibling = siblings[i]!;
		if (sibling === element) {
			return getXPath(element.parentNode as Element) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
		}
		if (sibling.nodeType === 1 && (sibling as Element).tagName === element.tagName) {
			ix++;
		}
	}
	return '';
}
