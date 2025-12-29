// goal: Ruler tool panel UI
// tradeoff: uses content script for on-page measurement overlay

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { RulerMeasurement } from './types';
import { formatValue, copyToClipboard, saveSettings, loadSettings } from './core';

const logger = createLogger('Ruler', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  startBtn: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #4a9eff, #7c3aed)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.1s',
  },
  activeBtn: {
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
  },
  optionsRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    fontSize: '12px',
    color: '#888',
  },
  select: {
    padding: '6px 10px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#ddd',
    fontSize: '12px',
  },
  input: {
    width: '60px',
    padding: '6px 8px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#ddd',
    fontSize: '12px',
    textAlign: 'center',
  },
  measurementCard: {
    background: '#1e1e1e',
    borderRadius: '8px',
    padding: '16px',
  },
  measureGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  measureItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  measureLabel: {
    fontSize: '10px',
    color: '#666',
    textTransform: 'uppercase',
  },
  measureValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#fff',
    fontFamily: 'monospace',
    cursor: 'pointer',
  },
  diagonalRow: {
    marginTop: '8px',
    paddingTop: '12px',
    borderTop: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hint: {
    fontSize: '11px',
    color: '#666',
    textAlign: 'center',
    padding: '8px',
  },
  toast: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    background: '#22c55e',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#fff',
    zIndex: 1000,
  },
};

export const RulerPanel: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [measurement, setMeasurement] = useState<RulerMeasurement | null>(null);
  const [unit, setUnit] = useState<'px' | 'rem'>('px');
  const [remBase, setRemBase] = useState(16);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(({ unit: u, remBase: r }) => {
      setUnit(u);
      setRemBase(r);
    });

    // Listen for measurement results from content script
    const listener = (message: { type: string; data?: RulerMeasurement }): boolean | undefined => {
      if (message.type === 'HALO_RULER_RESULT' && message.data) {
        setMeasurement(message.data);
        setIsActive(false);
        logger.info('Measurement received:', message.data);
      }
      return undefined;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const handleToggle = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (isActive) {
      // Cancel measurement
      await chrome.tabs.sendMessage(tab.id, { type: 'HALO_RULER_CANCEL' });
      setIsActive(false);
    } else {
      // Start measurement
      await chrome.tabs.sendMessage(tab.id, { type: 'HALO_RULER_START' });
      setIsActive(true);
      logger.info('Ruler started');
    }
  }, [isActive]);

  const handleUnitChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = e.target.value as 'px' | 'rem';
    setUnit(newUnit);
    await saveSettings({ unit: newUnit, remBase });
  }, [remBase]);

  const handleRemBaseChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 16;
    setRemBase(val);
    await saveSettings({ unit, remBase: val });
  }, [unit]);

  const handleCopyValue = useCallback(async (value: string) => {
    const ok = await copyToClipboard(value);
    showToast(ok ? 'Copied!' : 'Copy failed');
  }, [showToast]);

  const widthStr = measurement ? formatValue(measurement.width, unit, remBase) : '-';
  const heightStr = measurement ? formatValue(measurement.height, unit, remBase) : '-';
  const diagStr = measurement ? formatValue(measurement.diagonal, unit, remBase) : '-';

  return (
    <div style={styles.wrapper}>
      <button
        style={{ ...styles.startBtn, ...(isActive ? styles.activeBtn : {}) }}
        onClick={handleToggle}
      >
        {isActive ? '⏹️ Cancel Measurement' : '📐 Start Measuring'}
      </button>

      {isActive && (
        <div style={styles.hint}>
          Click and drag on the page to measure an area
        </div>
      )}

      <Card variant="default" padding="sm">
        <div style={styles.optionsRow}>
          <span>Unit:</span>
          <select value={unit} onChange={handleUnitChange} style={styles.select}>
            <option value="px">Pixels (px)</option>
            <option value="rem">REM</option>
          </select>
          {unit === 'rem' && (
            <>
              <span>Base:</span>
              <input
                type="number"
                value={remBase}
                onChange={handleRemBaseChange}
                style={styles.input}
                min={1}
                max={32}
              />
              <span>px</span>
            </>
          )}
        </div>
      </Card>

      {measurement && (
        <div style={styles.measurementCard}>
          <div style={styles.measureGrid}>
            <div style={styles.measureItem}>
              <span style={styles.measureLabel}>Width</span>
              <span
                style={styles.measureValue}
                onClick={() => handleCopyValue(widthStr)}
                title="Click to copy"
              >
                {widthStr}
              </span>
            </div>
            <div style={styles.measureItem}>
              <span style={styles.measureLabel}>Height</span>
              <span
                style={styles.measureValue}
                onClick={() => handleCopyValue(heightStr)}
                title="Click to copy"
              >
                {heightStr}
              </span>
            </div>
          </div>
          <div style={styles.diagonalRow}>
            <span style={{ ...styles.measureLabel, margin: 0 }}>Diagonal</span>
            <span
              style={{ ...styles.measureValue, fontSize: '14px' }}
              onClick={() => handleCopyValue(diagStr)}
              title="Click to copy"
            >
              {diagStr}
            </span>
          </div>
        </div>
      )}

      {!measurement && !isActive && (
        <div style={styles.hint}>
          No measurement yet. Click the button above to start.
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};
