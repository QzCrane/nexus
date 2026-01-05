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
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
    overflow: hidden;
    opacity: 0;
    transform: scale(0.92) translateY(8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    background: linear-gradient(135deg, rgba(30,30,35,0.95), rgba(20,20,25,0.98));
    backdrop-filter: blur(20px) saturate(180%);
    pointer-events: auto;
}

.halo-hz-viewer.visible {
    opacity: 1;
    transform: scale(1) translateY(0);
}

.halo-hz-image {
    display: block;
    max-width: none; max-height: none;
    object-fit: contain;
    transform-origin: center;
    transition: transform 0.2s ease, opacity 0.3s ease;
    cursor: default;
    user-select: none;
    -webkit-user-drag: none;
}

.halo-hz-viewer.dragging .halo-hz-image { cursor: grabbing; }

.halo-hz-spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(255,255,255,0.15);
    border-radius: 50%;
    border-top-color: rgba(255,255,255,0.9);
    animation: halo-hz-spin 0.8s linear infinite;
    position: absolute;
    top: 50%; left: 50%;
    margin: -18px 0 0 -18px;
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
