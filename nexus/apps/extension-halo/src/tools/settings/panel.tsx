// goal: Settings panel UI component

import React, { useState, useCallback, useEffect } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { HaloSettings, ThemeMode } from '../../kernel/settings';
import { ACCENT_COLORS, DEFAULT_SETTINGS } from '../../kernel/settings';
import { loadSettings, saveSettings, getThemeColors, applyTheme } from '../../kernel/theme';

const logger = createLogger('Settings', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--halo-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
  },
  label: {
    fontSize: '13px',
    color: 'var(--halo-text)',
  },
  sublabel: {
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
    marginTop: '2px',
  },
  themeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  themeBtn: {
    padding: '12px 8px',
    border: '2px solid var(--halo-border)',
    borderRadius: '8px',
    background: 'var(--halo-bg-secondary)',
    color: 'var(--halo-text)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  themeBtnActive: {
    borderColor: 'var(--halo-accent)',
    background: 'var(--halo-bg-tertiary)',
  },
  colorGrid: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  colorSwatch: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    cursor: 'pointer',
    border: '2px solid transparent',
    transition: 'transform 0.1s, border-color 0.15s',
  },
  colorSwatchActive: {
    borderColor: 'var(--halo-text)',
    transform: 'scale(1.1)',
  },
  select: {
    padding: '8px 12px',
    background: 'var(--halo-bg-tertiary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '6px',
    color: 'var(--halo-text)',
    fontSize: '12px',
    minWidth: '120px',
  },
  resetBtn: {
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid var(--halo-border)',
    borderRadius: '6px',
    color: 'var(--halo-text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  version: {
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
    textAlign: 'center',
    padding: '12px 0',
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

interface SettingsPanelProps {
  onSettingsChange?: (settings: HaloSettings) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onSettingsChange }) => {
  const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const updateSetting = useCallback(async <K extends keyof HaloSettings>(
    key: K,
    value: HaloSettings[K]
  ) => {
    const updated = await saveSettings({ [key]: value });
    setSettings(updated);
    
    // Apply theme changes immediately
    if (key === 'theme' || key === 'accentColor') {
      const colors = getThemeColors(updated.theme, updated.accentColor);
      applyTheme(colors);
    }
    
    onSettingsChange?.(updated);
    logger.info(`Setting updated: ${key}`, value);
  }, [onSettingsChange]);

  const handleReset = useCallback(async () => {
    const updated = await saveSettings(DEFAULT_SETTINGS);
    setSettings(updated);
    const colors = getThemeColors(updated.theme, updated.accentColor);
    applyTheme(colors);
    onSettingsChange?.(updated);
    showToast('Settings reset to defaults');
  }, [onSettingsChange, showToast]);

  return (
    <div style={styles.wrapper}>
      {/* Appearance */}
      <Card variant="default" padding="md">
        <div style={styles.section}>
          <span style={styles.sectionTitle}>🎨 Appearance</span>
          
          <div>
            <div style={styles.label}>Theme</div>
            <div style={{ ...styles.sublabel, marginBottom: '8px' }}>
              Choose your preferred color scheme
            </div>
            <div style={styles.themeGrid}>
              {(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateSetting('theme', mode)}
                  style={{
                    ...styles.themeBtn,
                    ...(settings.theme === mode ? styles.themeBtnActive : {}),
                  }}
                >
                  <span style={{ fontSize: '18px' }}>
                    {mode === 'dark' ? '🌙' : mode === 'light' ? '☀️' : '💻'}
                  </span>
                  <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={styles.label}>Accent Color</div>
            <div style={{ ...styles.sublabel, marginBottom: '8px' }}>
              Customize the primary color
            </div>
            <div style={styles.colorGrid}>
              {ACCENT_COLORS.map((color) => (
                <div
                  key={color.value}
                  onClick={() => updateSetting('accentColor', color.value)}
                  style={{
                    ...styles.colorSwatch,
                    background: color.value,
                    ...(settings.accentColor === color.value ? styles.colorSwatchActive : {}),
                  }}
                  title={color.name}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Interface */}
      <Card variant="default" padding="md">
        <div style={styles.section}>
          <span style={styles.sectionTitle}>⚙️ Interface</span>
          
          <div style={styles.row}>
            <div>
              <div style={styles.label}>Compact Mode</div>
              <div style={styles.sublabel}>Reduce spacing for smaller screens</div>
            </div>
            <Toggle
              checked={settings.compactMode}
              onChange={(checked) => updateSetting('compactMode', checked)}
            />
          </div>

          <div style={styles.row}>
            <div>
              <div style={styles.label}>Show Tool Labels</div>
              <div style={styles.sublabel}>Display text under tool icons</div>
            </div>
            <Toggle
              checked={settings.showToolLabels}
              onChange={(checked) => updateSetting('showToolLabels', checked)}
            />
          </div>

          <div style={styles.row}>
            <div>
              <div style={styles.label}>Animations</div>
              <div style={styles.sublabel}>Enable smooth transitions</div>
            </div>
            <Toggle
              checked={settings.animationsEnabled}
              onChange={(checked) => updateSetting('animationsEnabled', checked)}
            />
          </div>
        </div>
      </Card>

      {/* Actions */}
      <Card variant="default" padding="md">
        <div style={styles.section}>
          <span style={styles.sectionTitle}>🔧 Actions</span>
          
          <button style={styles.resetBtn} onClick={handleReset}>
            ↻ Reset All Settings
          </button>
        </div>
      </Card>

      {/* Version */}
      <div style={styles.version}>
        HALO v0.2.0 • Made with 💜
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};
