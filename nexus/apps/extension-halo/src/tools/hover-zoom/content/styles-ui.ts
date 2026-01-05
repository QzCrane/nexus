// goal: UI component styles for Hover Zoom
// eff: Info bar, actions, zoom indicator

export const UI_STYLES = `
.halo-hz-info {
    position: absolute;
    left: 0; right: 0;
    padding: 10px 14px;
    background: linear-gradient(to top, rgba(0,0,0,0.75), transparent);
    color: white;
    font-size: 12px;
    line-height: 1.5;
    pointer-events: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.halo-hz-viewer:hover .halo-hz-info { opacity: 1; }
.halo-hz-info.top { top: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.75), transparent); }
.halo-hz-info.bottom { bottom: 0; }

.halo-hz-caption {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
}

.halo-hz-meta {
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    font-size: 11px;
    opacity: 0.75;
    white-space: nowrap;
    background: rgba(255,255,255,0.1);
    padding: 2px 8px;
    border-radius: 4px;
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
