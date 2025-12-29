// goal: Outline tool panel UI

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { HeadingItem, OutlineSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  extractHeadings,
  scrollToHeading,
  outlineToMarkdown,
  copyToClipboard,
  loadSettings,
  saveSettings,
} from './core';

const logger = createLogger('Outline', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
  },
  btn: {
    flex: 1,
    padding: '10px 12px',
    background: 'var(--halo-bg-tertiary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '6px',
    color: 'var(--halo-text)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, var(--halo-accent), #4a9eff)',
    border: 'none',
    fontWeight: 600,
  },
  outlineList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  headingItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'var(--halo-bg-secondary)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.1s',
    fontSize: '13px',
    color: 'var(--halo-text)',
  },
  headingLevel: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--halo-accent)',
    minWidth: '24px',
  },
  headingText: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionsRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
  },
  select: {
    padding: '4px 8px',
    background: 'var(--halo-bg-tertiary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '4px',
    color: 'var(--halo-text)',
    fontSize: '11px',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: 'var(--halo-text-muted)',
    fontSize: '13px',
    textAlign: 'center',
  },
  stats: {
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
    textAlign: 'center',
  },
  toast: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    background: 'var(--halo-success)',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#fff',
    zIndex: 1000,
  },
};

export const OutlinePanel: React.FC = () => {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [settings, setSettings] = useState<OutlineSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const handleExtract = useCallback(async () => {
    setLoading(true);
    try {
      const extracted = await extractHeadings(settings);
      setHeadings(extracted);
      logger.info('Extracted', extracted.length, 'headings');
    } catch (e) {
      logger.error('Extract failed:', e);
      showToast('Failed to extract headings');
    } finally {
      setLoading(false);
    }
  }, [settings, showToast]);

  const handleHeadingClick = useCallback(async (index: number) => {
    await scrollToHeading(index);
  }, []);

  const handleCopyMarkdown = useCallback(async () => {
    const md = outlineToMarkdown(headings, settings.showNumbers);
    const ok = await copyToClipboard(md);
    showToast(ok ? 'Markdown copied!' : 'Copy failed');
  }, [headings, settings.showNumbers, showToast]);

  const handleSettingChange = useCallback(async <K extends keyof OutlineSettings>(
    key: K,
    value: OutlineSettings[K]
  ) => {
    const updated = await saveSettings({ [key]: value });
    setSettings(updated);
  }, []);

  // Calculate level distribution
  const levelCounts = headings.reduce((acc, h) => {
    acc[h.level] = (acc[h.level] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  return (
    <div style={styles.wrapper}>
      <Card variant="default" padding="sm">
        <div style={styles.optionsRow}>
          <span>Levels:</span>
          <select
            value={settings.minLevel}
            onChange={(e) => handleSettingChange('minLevel', parseInt(e.target.value))}
            style={styles.select}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>H{n}</option>
            ))}
          </select>
          <span>to</span>
          <select
            value={settings.maxLevel}
            onChange={(e) => handleSettingChange('maxLevel', parseInt(e.target.value))}
            style={styles.select}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>H{n}</option>
            ))}
          </select>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={settings.showNumbers}
              onChange={(e) => handleSettingChange('showNumbers', e.target.checked)}
            />
            Numbers
          </label>
        </div>
      </Card>

      <div style={styles.actionRow}>
        <button
          style={{ ...styles.btn, ...styles.primaryBtn }}
          onClick={handleExtract}
          disabled={loading}
        >
          {loading ? '⏳ Extracting...' : '📋 Extract Outline'}
        </button>
        {headings.length > 0 && (
          <button style={styles.btn} onClick={handleCopyMarkdown}>
            📝 Copy MD
          </button>
        )}
      </div>

      {headings.length > 0 ? (
        <>
          <div style={styles.outlineList}>
            {headings.map((h, i) => (
              <div
                key={h.id}
                style={{
                  ...styles.headingItem,
                  paddingLeft: `${12 + (h.level - 1) * 16}px`,
                }}
                onClick={() => handleHeadingClick(i)}
                title="Click to scroll"
              >
                <span style={styles.headingLevel}>H{h.level}</span>
                <span style={styles.headingText}>{h.text || '(empty)'}</span>
              </div>
            ))}
          </div>
          <div style={styles.stats}>
            {headings.length} headings • 
            {Object.entries(levelCounts).map(([lvl, cnt]) => 
              ` H${lvl}: ${cnt}`
            ).join(' •')}
          </div>
        </>
      ) : (
        <div style={styles.empty}>
          <span style={{ fontSize: '32px', opacity: 0.3, marginBottom: '8px' }}>📋</span>
          <p>Click "Extract Outline" to scan this page</p>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};
