import type { ScriptType, UserScriptRunAt } from './types';

// Script templates
export const SCRIPT_TEMPLATES = {
	adblock: {
		name: 'Simple Ad Blocker',
		description: 'Removes common ad elements',
		type: 'javascript' as ScriptType,
		code: `// Remove common ad containers
const adSelectors = [
  '[class*="ad-"]', '[class*="ads-"]', '[id*="ad-"]', '[id*="ads-"]',
  '.ad', '.ads', '.advertisement', '.banner-ad',
  'iframe[src*="ads"]', 'iframe[src*="doubleclick"]'
];
adSelectors.forEach(sel => {
  document.querySelectorAll(sel).forEach(el => el.remove());
});`,
		matches: ['*://*/*'],
		runAt: 'document_end' as UserScriptRunAt,
	},
	darkForce: {
		name: 'Force Dark Mode',
		description: 'Apply dark theme to any page',
		type: 'javascript' as ScriptType,
		code: `// Force dark mode via filter
document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
document.querySelectorAll('img, video, picture').forEach(el => {
  el.style.filter = 'invert(1) hue-rotate(180deg)';
});`,
		matches: ['*://*/*'],
		runAt: 'document_end' as UserScriptRunAt,
	},
	removeOverlay: {
		name: 'Remove Overlay/Modal',
		description: 'Remove fixed overlays and restore scroll',
		type: 'javascript' as ScriptType,
		code: `// Remove overlays and restore scroll
setInterval(() => {
  document.querySelectorAll('[style*="position: fixed"]').forEach(el => {
    if (parseInt(el.style.zIndex) > 1000) el.remove();
  });
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
}, 500);`,
		matches: ['*://*/*'],
		runAt: 'document_end' as UserScriptRunAt,
	},
	customCSS: {
		name: 'Custom CSS',
		description: 'Inject custom styles',
		type: 'css' as ScriptType,
		code: `/* Custom styles */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}`,
		matches: ['*://*/*'],
		runAt: 'document_start' as UserScriptRunAt,
	},
	blockSpace: {
		name: 'Block Space Scroll',
		description: 'Manually toggles video play/pause on spacebar (scroll blocking is now HALO default)',
		type: 'javascript' as ScriptType,
		code: `// Block space scroll + manually control video play/pause
(function() {
    if (window.__halo_space_blocker) return;
    window.__halo_space_blocker = true;

    // Find the most visible video on the page
    function findActiveVideo() {
        const videos = document.querySelectorAll('video');
        let best = null, bestArea = 0;
        for (const v of videos) {
            const rect = v.getBoundingClientRect();
            // Check if video is visible in viewport
            if (rect.width > 50 && rect.height > 50 && rect.top < window.innerHeight && rect.bottom > 0) {
                const area = rect.width * rect.height;
                if (area > bestArea) { bestArea = area; best = v; }
            }
        }
        return best;
    }

    function shouldBlock(event) {
        if (event.code !== 'Space' && event.keyCode !== 32) return false;

        // Find real active element
        let el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;

        if (el) {
            const tag = el.tagName;
            // Allow typing in text fields
            if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return false;
            const role = el.getAttribute('role');
            if (role === 'textbox' || role === 'searchbox') return false;
        }
        return true;
    }

    function handleSpace(event) {
        if (!shouldBlock(event)) return;

        // Block scroll completely
        event.preventDefault();
        event.stopImmediatePropagation();

        // Only toggle video on keydown (not keyup) to avoid double-toggle
        if (event.type === 'keydown') {
            const video = findActiveVideo();
            if (video) {
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            }
        }
    }

    window.addEventListener('keydown', handleSpace, true);
    window.addEventListener('keyup', handleSpace, true);
    console.log('[HALO] Space blocker v3 (manual video control)');
})();`,
		matches: ['*://*/*'],
		runAt: 'document_start' as UserScriptRunAt,
	},
};
