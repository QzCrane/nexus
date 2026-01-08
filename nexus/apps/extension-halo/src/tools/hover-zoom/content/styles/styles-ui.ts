// goal: UI component styles for Hover Zoom
// eff: Info bar, actions, zoom indicator

export const UI_STYLES = `
/* Info bar - spans full viewer width including border */
.halo-hz-info {
    position: absolute;
    left: -2px;
    width: calc(100% + 4px);  /* Content width + 2px border on each side */
    top: 100%;  /* Position right below content */
    height: 24px;
    background: #fff;
    color: #333;
    font-size: 11px;
    pointer-events: none;
    box-sizing: border-box;  /* Ensure width includes any padding */
    /* Flexbox for perfect centering */
    display: flex;
    justify-content: center;
    align-items: center;
}

/* Position classes (kept for compatibility) */
.halo-hz-info.top, .halo-hz-info.bottom { }
.halo-hz-info.none { display: none; }

.halo-hz-caption {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 300px;
}

.halo-hz-meta {
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    font-size: 13px;
    color: #555;
    white-space: nowrap;
}

.halo-hz-actions {
    position: absolute;
    top: 10px; right: 10px;
    display: flex;
    gap: 6px;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: auto;
}

.halo-hz-viewer:hover .halo-hz-actions { opacity: 1; }

.halo-hz-action-btn {
    width: 32px; height: 32px;
    border-radius: 8px;
    border: none;
    background: rgba(255,255,255,0.15);
    color: white;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, transform 0.15s ease;
    backdrop-filter: blur(10px);
}

.halo-hz-action-btn:hover { background: rgba(255,255,255,0.25); transform: scale(1.05); }
.halo-hz-action-btn:active { transform: scale(0.95); }

.halo-hz-zoom-indicator {
    position: absolute;
    bottom: 50px; left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.7);
    color: white;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
}

.halo-hz-zoom-indicator.visible { opacity: 1; }
`;
