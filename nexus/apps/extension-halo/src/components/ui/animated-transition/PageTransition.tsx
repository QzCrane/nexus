// goal: High-level wrapper for common page transition patterns
// eff: Simplified API for sub-page stack transitions (e.g., list -> editor)

import React, { CSSProperties, ReactNode } from 'react';
import { AnimatedTransition } from './AnimatedTransition';
import type { TransitionType, SlideDirection } from './types';

interface PageTransitionProps {
  /** Current active page key */
  activePage: string;
  /** Page definitions */
  pages: Array<{
    key: string;
    content: ReactNode;
    /** Animation type for this page (default: slideUp for non-home pages) */
    type?: TransitionType;
    /** Slide direction */
    direction?: SlideDirection;
  }>;
  /** Container style */
  style?: CSSProperties;
  /** Container class */
  className?: string;
}

/**
 * PageTransition - Manages multiple pages with animated transitions.
 * 
 * @example
 * <PageTransition 
 *   activePage={showEditor ? 'editor' : 'list'}
 *   pages={[
 *     { key: 'list', content: <ScriptList /> },
 *     { key: 'editor', content: <ScriptEditor />, type: 'slideUp' }
 *   ]}
 * />
 */
export const PageTransition: React.FC<PageTransitionProps> = ({
  activePage,
  pages,
  style,
  className,
}) => {
  // Find home page (first in array) - it uses fade or stays visible
  const homePage = pages[0];
  const isHome = activePage === homePage?.key;

  return (
    <div 
      className={className}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%',
        overflow: 'hidden',
        ...style 
      }}
    >
      {pages.map((page, index) => {
        const isActive = activePage === page.key;
        const isHomePage = index === 0;
        
        // Home page: always mounted, fades slightly when covered
        // Other pages: slide up when active
        const type = page.type ?? (isHomePage ? 'fade' : 'slideUp');
        
        return (
          <div
            key={page.key}
            style={{
              position: isHomePage ? 'relative' : 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: isHomePage ? 0 : 1,
            }}
          >
            <AnimatedTransition
              show={isActive}
              type={type}
              direction={page.direction}
              keepMounted={isHomePage} // Keep home page mounted
            >
              {page.content}
            </AnimatedTransition>
          </div>
        );
      })}
    </div>
  );
};

export default PageTransition;
