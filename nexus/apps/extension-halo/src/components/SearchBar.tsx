import { isLaunchablePlugin } from '../kernel';
// goal: Global search bar component
// eff: Fuzzy search with keyboard shortcuts

import type React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { ToolMeta } from '../kernel/registry/tool-registry';
import { TOOL_REGISTRY } from '../kernel/registry/tool-registry';
import { useTranslation } from '../i18n';
import { searchBarStyles as styles } from './styles/search-bar';

interface SearchBarProps {
  onSelect: (toolId: string) => void;
  placeholder?: string;
}

function normalizeSearch(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '');
}

function matchTool(tool: ToolMeta, query: string, t: (k: string) => string): boolean {
  if (!query) return false;
  const q = normalizeSearch(query);
  if (tool.id.includes(q)) return true;
  if (tool.keywords.some((kw) => normalizeSearch(kw).includes(q))) return true;
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

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const matched = TOOL_REGISTRY.filter((tool) => matchTool(tool, query, t));
    setResults(matched);
    setActiveIndex(0);
  }, [query, t]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
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
      if (selected && (isLaunchablePlugin(selected))) {
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
    if (isLaunchablePlugin(tool)) {
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
              <button
                type="button"
                key={tool.id}
                style={{
                  ...styles.item,
                  ...(i === activeIndex ? styles.itemActive : {}),
                  width: '100%',
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSelect(tool)}
              >
                <span style={styles.itemIcon as React.CSSProperties}>{tool.icon}</span>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>{t(`tools.${tool.id}.name`)}</div>
                  <div style={styles.itemDesc}>{t(`tools.${tool.id}.desc`)}</div>
                </div>
                {!isLaunchablePlugin(tool) && (
                  <span style={{
                    ...styles.itemStatus,
                    background: 'var(--halo-warning-alpha, rgba(245, 158, 11, 0.2))',
                    color: 'var(--halo-warning, #f59e0b)',
                  }}>
                    {t('common.comingSoon')}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div style={styles.noResults}>{t('common.noResults')}</div>
          )}
        </div>
      )}
    </div>
  );
};
