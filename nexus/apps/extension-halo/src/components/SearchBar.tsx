// goal: Global search bar component
// eff: Fuzzy search with keyboard shortcuts. Logic extracted to search-utils.ts and styles to SearchBar.styles.ts

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ToolMeta } from '../kernel';
import { TOOL_REGISTRY } from '../kernel';
import { useTranslation } from '../i18n';
import { matchTool } from './search-utils';
import { styles } from './SearchBar.styles';

interface SearchBarProps {
  onSelect: (toolId: string) => void;
  visibleTools: ToolMeta[];
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSelect, visibleTools, placeholder }) => {
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
    const matched = visibleTools.filter((tool) => matchTool(tool, query, t));
    setResults(matched);
    setActiveIndex(0);
  }, [query, t, visibleTools]);

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
      const isSystem = selected?.system || selected?.id === 'permissions';
      if (selected && (selected.status === 'ready' || selected.status === 'beta' || isSystem)) {
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
    const isSystem = tool.system || tool.id === 'permissions';
    if (tool.status === 'ready' || tool.status === 'beta' || isSystem) {
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
