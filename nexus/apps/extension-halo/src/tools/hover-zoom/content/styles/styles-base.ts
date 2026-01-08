// goal: Base CSS styles for Hover Zoom viewer
// eff: Container, viewer, and image styles

export const BASE_STYLES = `
#halo-hover-zoom-container {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    top: 0; left: 0; width: 0; height: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.halo-hz-viewer {
    position: fixed;
    box-sizing: content-box;  /* Width/height is content, border is outside */
    border-radius: 0;
    /* Pure white border like PhotoShow */
    border: 2px solid #fff;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    /* Allow info bar to extend outside container */
    overflow: visible;
    opacity: 0;
    /* Smooth expand animation from source - transition set dynamically in JS */
    background: transparent;
    pointer-events: none;
}

.halo-hz-viewer.visible {
    opacity: 1;
    pointer-events: auto;
}

.halo-hz-image,
.halo-hz-video {
    display: block;
    cursor: default;
    user-select: none;
    -webkit-user-drag: none;
}

.halo-hz-viewer.dragging .halo-hz-image,
.halo-hz-viewer.dragging .halo-hz-video { cursor: grabbing; }

.halo-hz-spinner {
    display: none;
}

/* Loading indicator overlay - uses fixed positioning to avoid parent overflow issues */
.halo-hz-loading-overlay {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 4px;
}

.halo-hz-loading-spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(255,255,255,0.25);
    border-radius: 50%;
    border-top-color: rgba(100,150,255,0.95);
    animation: halo-hz-spin 0.7s linear infinite;
}

@keyframes halo-hz-spin { to { transform: rotate(360deg); } }

.halo-hz-error {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255,100,100,0.9);
    font-size: 13px;
    text-align: center;
}
.halo-hz-error::before { content: '⚠'; display: block; font-size: 28px; margin-bottom: 8px; }
`;
