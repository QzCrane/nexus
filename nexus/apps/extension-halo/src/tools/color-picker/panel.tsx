// goal: Color Picker tool panel UI

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { ColorInfo } from './types';
import {
  parseColor,
  getColorInfo,
  copyToClipboard,
  saveToHistory,
  loadHistory,
} from './core';

const logger = createLogger('ColorPicker', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  pickerRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  colorInput: {
    width: '60px',
    height: '40px',
    border: '2px solid #444',
    borderRadius: '8px',
    cursor: 'pointer',
    padding: 0,
    background: 'transparent',
  },
  textInput: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #444',
    borderRadius: '6px',
    background: '#2a2a2a',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'monospace',
  },
  preview: {
    width: '100%',
    height: '80px',
    borderRadius: '8px',
    border: '1px solid #444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'background 0.2s',
  },
  valuesGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
  },
  valueBox: {
    background: '#252525',
    borderRadius: '6px',
    padding: '10px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  valueLabel: {
    fontSize: '10px',
    color: '#666',
    marginBottom: '4px',
  },
  valueText: {
    fontSize: '12px',
    color: '#ddd',
    fontFamily: 'monospace',
  },
  historySection: {
    marginTop: '4px',
  },
  historyTitle: {
    fontSize: '11px',
    color: '#888',
    marginBottom: '6px',
  },
  historyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(10, 1fr)',
    gap: '4px',
  },
  historySwatch: {
    aspectRatio: '1',
    borderRadius: '4px',
    border: '1px solid #444',
    cursor: 'pointer',
    transition: 'transform 0.1s',
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

// inv: determine text color based on background luminance
function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export const ColorPickerPanel: React.FC = () => {
  const [color, setColor] = useState<ColorInfo>(getColorInfo('#7c3aed'));
  const [inputValue, setInputValue] = useState('#7c3aed');
  const [history, setHistory] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadHistory().then(setHistory);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const handleColorChange = useCallback(async (hex: string) => {
    const info = getColorInfo(hex);
    setColor(info);
    setInputValue(hex);
    const updated = await saveToHistory(hex);
    setHistory(updated);
    logger.info('Color selected:', hex);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const parsed = parseColor(value);
    if (parsed) {
      setColor(parsed);
    }
  }, []);

  const handleInputBlur = useCallback(async () => {
    const parsed = parseColor(inputValue);
    if (parsed) {
      const updated = await saveToHistory(parsed.hex);
      setHistory(updated);
    }
  }, [inputValue]);

  const handleCopyValue = useCallback(async (value: string, label: string) => {
    const ok = await copyToClipboard(value);
    showToast(ok ? `${label} copied!` : 'Copy failed');
  }, [showToast]);

  const handleHistoryClick = useCallback((hex: string) => {
    handleColorChange(hex);
  }, [handleColorChange]);

  const rgbStr = `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
  const hslStr = `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`;

  return (
    <div style={styles.wrapper}>
      <Card variant="default" padding="md">
        <div style={styles.pickerRow}>
          <input
            type="color"
            value={color.hex}
            onChange={(e) => handleColorChange(e.target.value)}
            style={styles.colorInput}
            title="Pick a color"
          />
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder="#hex or rgb(...)"
            style={styles.textInput}
          />
        </div>
      </Card>

      <div
        style={{
          ...styles.preview,
          background: color.hex,
          color: getContrastColor(color.hex),
        }}
      >
        {color.hex.toUpperCase()}
      </div>

      <div style={styles.valuesGrid}>
        <div
          style={styles.valueBox}
          onClick={() => handleCopyValue(color.hex, 'HEX')}
          title="Click to copy"
        >
          <div style={styles.valueLabel}>HEX</div>
          <div style={styles.valueText}>{color.hex}</div>
        </div>
        <div
          style={styles.valueBox}
          onClick={() => handleCopyValue(rgbStr, 'RGB')}
          title="Click to copy"
        >
          <div style={styles.valueLabel}>RGB</div>
          <div style={styles.valueText}>{color.rgb.r}, {color.rgb.g}, {color.rgb.b}</div>
        </div>
        <div
          style={styles.valueBox}
          onClick={() => handleCopyValue(hslStr, 'HSL')}
          title="Click to copy"
        >
          <div style={styles.valueLabel}>HSL</div>
          <div style={styles.valueText}>{color.hsl.h}°, {color.hsl.s}%, {color.hsl.l}%</div>
        </div>
      </div>

      {history.length > 0 && (
        <div style={styles.historySection}>
          <div style={styles.historyTitle}>Recent Colors</div>
          <div style={styles.historyGrid}>
            {history.slice(0, 20).map((hex, i) => (
              <div
                key={i}
                style={{ ...styles.historySwatch, background: hex }}
                onClick={() => handleHistoryClick(hex)}
                title={hex}
              />
            ))}
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};
