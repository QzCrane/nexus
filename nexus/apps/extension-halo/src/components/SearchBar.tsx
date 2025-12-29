// goal: Global search bar component
// eff: Fuzzy search with keyboard shortcuts

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ToolMeta } from '../kernel/tool-registry';
import { TOOL_REGISTRY } from '../kernel/tool-registry';
import { useTranslation } from '../i18n';

interface SearchBarProps {
  onSelect: (toolId: string) => void;
  placeholder?: string;
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    width: '100%',
  },
  inputWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'var(--halo-bg-secondary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '8px',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  inputWrapperFocus: {
    borderColor: 'var(--halo-accent)',
    boxShadow: '0 0 0 2px var(--halo-accent-alpha, rgba(124, 58, 237, 0.2))',
  },
  icon: {
    fontSize: '14px',
    opacity: 0.6,
  },
  input: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: 'var(--halo-text)',
    fontSize: '13px',
    outline: 'none',
  },
  shortcut: {
    fontSize: '10px',
    padding: '2px 6px',
    background: 'var(--halo-bg-tertiary)',
    borderRadius: '4px',
    color: 'var(--halo-text-muted)',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: 'var(--halo-bg-secondary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '8px',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 100,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  itemActive: {
    background: 'var(--halo-bg-tertiary)',
  },
  itemIcon: {
    fontSize: '16px',
    width: '24px',
    textAlign: 'center',
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: '13px',
    color: 'var(--halo-text)',
    fontWeight: 500,
  },
  itemDesc: {
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemStatus: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  noResults: {
    padding: '16px',
    textAlign: 'center',
    color: 'var(--halo-text-muted)',
    fontSize: '13px',
  },
};

function normalizeSearch(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '');
}

function matchTool(tool: ToolMeta, query: string, t: (k: string) => string): boolean {
  if (!query) return false;
  const q = normalizeSearch(query);
  // ID match
  if (tool.id.includes(q)) return true;
  // Keywords match
  if (tool.keywords.some((kw) => normalizeSearch(kw).includes(q))) return true;
  // Translated name match
  const name = normalizeSearch(t(`tools.${tool.id}.name`));
  return name.includes(q);
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSelect, placeholder }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ToolMeta[]>([]);

  // Filter results
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const matched = TOOL_REGISTRY.filter((tool) => matchTool(tool, query, t));
    setResults(matched);
    setActiveIndex(0);
  }, [query, t]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!results.length) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[activeIndex];
      if (selected && (selected.status === 'ready' || selected.status === 'beta')) {
        onSelect(selected.id);
        setQuery('');
        inputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
    }
  }, [results, activeIndex, onSelect]);

  const handleSelect = useCallback((tool: ToolMeta) => {
    if (tool.status === 'ready' || tool.status === 'beta') {
      onSelect(tool.id);
      setQuery('');
    }
  }, [onSelect]);

  const showDropdown = focused && query.trim().length > 0;

  return (
    <div style={styles.wrapper}>
      <div style={{
        ...styles.inputWrapper,
        ...(focused ? styles.inputWrapperFocus : {}),
      }}>
        <span style={styles.icon}>🔍</span>
        <input
          ref={inputRef}
          style={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t('common.search')}
        />
        {!focused && <span style={styles.shortcut}>⌘K</span>}
      </div>

      {showDropdown && (
        <div style={styles.dropdown}>
          {results.length > 0 ? (
            results.map((tool, i) => (
              <div
                key={tool.id}
                style={{
                  ...styles.item,
                  ...(i === activeIndex ? styles.itemActive : {}),
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSelect(tool)}
              >
                <span style={styles.itemIcon as React.CSSProperties}>{tool.icon}</span>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>{t(`tools.${tool.id}.name`)}</div>
                  <div style={styles.itemDesc}>{t(`tools.${tool.id}.desc`)}</div>
                </div>
                {tool.status === 'coming' && (
                  <span style={{
                    ...styles.itemStatus,
                    background: 'var(--halo-warning-alpha, rgba(245, 158, 11, 0.2))',
                    color: 'var(--halo-warning, #f59e0b)',
                  }}>
                    {t('common.comingSoon')}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div style={styles.noResults}>{t('common.noResults')}</div>
          )}
        </div>
      )}
    </div>
  );
};
