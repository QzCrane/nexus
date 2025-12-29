// goal: JSON Formatter tool panel UI

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import {
  formatJSON,
  minifyJSON,
  validateJSON,
  copyToClipboard,
  saveOptions,
  loadOptions,
} from './core';

const logger = createLogger('JSONFormatter', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  textarea: {
    width: '100%',
    minHeight: '140px',
    padding: '10px',
    border: '1px solid #444',
    borderRadius: '6px',
    background: '#1e1e1e',
    color: '#e0e0e0',
    fontSize: '12px',
    fontFamily: 'Consolas, Monaco, monospace',
    resize: 'vertical',
    lineHeight: 1.5,
  },
  errorArea: {
    borderColor: '#ef4444',
  },
  actionRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  btn: {
    padding: '8px 12px',
    background: '#333',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#ddd',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #4a9eff, #7c3aed)',
    border: 'none',
    fontWeight: 600,
  },
  optionsRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    fontSize: '11px',
    color: '#888',
  },
  select: {
    padding: '4px 8px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#ddd',
    fontSize: '11px',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#666',
    padding: '4px 0',
  },
  error: {
    color: '#ef4444',
    fontSize: '11px',
    padding: '6px 10px',
    background: '#1f1f1f',
    borderRadius: '4px',
    borderLeft: '3px solid #ef4444',
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

export const JSONFormatterPanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<FormatOptions>(DEFAULT_OPTIONS);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadOptions().then(setOptions);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const handleFormat = useCallback(() => {
    const result = formatJSON(input, options);
    if (result.success) {
      setInput(result.output);
      setError(null);
      logger.info('JSON formatted');
    } else {
      setError(result.error || 'Invalid JSON');
    }
  }, [input, options]);

  const handleMinify = useCallback(() => {
    const result = minifyJSON(input);
    if (result.success) {
      setInput(result.output);
      setError(null);
      logger.info('JSON minified');
    } else {
      setError(result.error || 'Invalid JSON');
    }
  }, [input]);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(input);
    showToast(ok ? 'Copied!' : 'Copy failed');
  }, [input, showToast]);

  const handleClear = useCallback(() => {
    setInput('');
    setError(null);
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      setError(null);
    } catch {
      showToast('Paste failed');
    }
  }, [showToast]);

  const handleIndentChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const indent = parseInt(e.target.value, 10) as 2 | 4;
    const newOptions = { ...options, indent };
    setOptions(newOptions);
    await saveOptions(newOptions);
  }, [options]);

  const handleSortChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newOptions = { ...options, sortKeys: e.target.checked };
    setOptions(newOptions);
    await saveOptions(newOptions);
  }, [options]);

  const validation = validateJSON(input);
  const charCount = input.length;
  const lineCount = input ? input.split('\n').length : 0;

  return (
    <div style={styles.wrapper}>
      <Card variant="default" padding="sm">
        <div style={styles.optionsRow}>
          <span>Indent:</span>
          <select
            value={options.indent}
            onChange={handleIndentChange}
            style={styles.select}
          >
            <option value={2}>2 spaces</option>
            <option value={4}>4 spaces</option>
          </select>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={options.sortKeys}
              onChange={handleSortChange}
            />
            Sort keys
          </label>
        </div>
      </Card>

      <textarea
        style={{ ...styles.textarea, ...(error ? styles.errorArea : {}) }}
        placeholder="Paste JSON here..."
        value={input}
        onChange={(e) => { setInput(e.target.value); setError(null); }}
      />

      {error && <div style={styles.error}>⚠️ {error}</div>}

      <div style={styles.actionRow}>
        <button
          style={{ ...styles.btn, ...styles.primaryBtn }}
          onClick={handleFormat}
          disabled={!input.trim()}
        >
          ✨ Format
        </button>
        <button style={styles.btn} onClick={handleMinify} disabled={!input.trim()}>
          📦 Minify
        </button>
        <button style={styles.btn} onClick={handleCopy} disabled={!input.trim()}>
          📋 Copy
        </button>
        <button style={styles.btn} onClick={handlePaste}>
          📥 Paste
        </button>
        <button style={styles.btn} onClick={handleClear} disabled={!input}>
          🗑️ Clear
        </button>
      </div>

      <div style={styles.statusBar}>
        <span>{lineCount} lines · {charCount} chars</span>
        <span style={{ color: validation.valid ? '#22c55e' : '#ef4444' }}>
          {validation.valid ? '✓ Valid' : '✗ Invalid'}
          {validation.size && ` · ${validation.size} bytes`}
        </span>
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};
