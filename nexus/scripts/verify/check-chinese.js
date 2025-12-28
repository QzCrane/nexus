/**
 * Check for Chinese characters in source code comments
 * Warns on Chinese in comments for gradual migration to English
 */

import fs from 'fs';
import path from 'path';
import { warn, ok, scanDir } from './utils.js';

// Skip directories
const SKIP_DIRS = ['node_modules', 'dist', '.turbo', '.git', 'public'];

// File extensions to check
const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

// Regex to detect Chinese characters
const CHINESE_REGEX = /[\u4e00-\u9fff]/;

// Extract comments from source code
function extractComments(content) {
  const comments = [];
  
  // Single-line comments: // ...
  const singleLine = content.match(/\/\/[^\n]*/g) || [];
  comments.push(...singleLine);
  
  // Multi-line comments: /* ... */
  const multiLine = content.match(/\/\*[\s\S]*?\*\//g) || [];
  comments.push(...multiLine);
  
  return comments;
}

/**
 * Check source files for Chinese characters in comments
 */
export function checkChineseComments(root) {
  console.log('\n📝 Checking for Chinese comments (migration reminder)...');
  
  const dirs = [
    path.join(root, 'apps'),
    path.join(root, 'packages'),
  ];
  
  let filesWithChinese = 0;
  let totalChineseComments = 0;
  
  for (const dir of dirs) {
    scanDir(dir, (filePath, entry) => {
      // Skip non-source files
      if (!CHECK_EXTENSIONS.some(ext => entry.name.endsWith(ext))) return;
      
      // Skip directories
      const relativePath = path.relative(root, filePath);
      if (SKIP_DIRS.some(d => relativePath.includes(d))) return;
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const comments = extractComments(content);
        
        let fileChineseCount = 0;
        for (const comment of comments) {
          if (CHINESE_REGEX.test(comment)) {
            fileChineseCount++;
          }
        }
        
        if (fileChineseCount > 0) {
          filesWithChinese++;
          totalChineseComments += fileChineseCount;
        }
      } catch (e) {
        // Ignore read errors
      }
    });
  }
  
  if (filesWithChinese > 0) {
    warn(`${filesWithChinese} files contain Chinese comments (${totalChineseComments} total)`);
    console.log('   → Gradual migration to English recommended');
  } else {
    ok('No Chinese comments found');
  }
}
