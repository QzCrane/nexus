/**
 * Check for Chinese characters in source code comments
 * Errors on Chinese in public-facing code (blocks sync)
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, scanDir, section, log } from './utils.ts';

// Skip directories
const SKIP_DIRS = ['node_modules', 'dist', '.turbo', '.git', 'public'];

// Skip apps/dirs that will not be synced to public
const SKIP_NON_PUBLIC = [
  'extension-halo',     // unreleased app
  'test',               // test files not synced
  'assets',             // dev assets not synced
  'scripts',            // scripts not synced
  'ui-kit',             // unused package
  'ai-engine',          // unused package
  'zen-engine',         // unused package
];

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
  section('Checking for Chinese comments (blocks sync)...');
  
  const dirs = [
    path.join(root, 'apps'),
    path.join(root, 'packages'),
  ];
  
  let filesWithChinese = 0;
  let totalChineseComments = 0;
  const affectedFiles = [];
  
  for (const dir of dirs) {
    scanDir(dir, (filePath, entry) => {
      // Skip non-source files
      if (!CHECK_EXTENSIONS.some(ext => entry.name.endsWith(ext))) return;
      
      // Skip directories
      const relativePath = path.relative(root, filePath);
      if (SKIP_DIRS.some(d => relativePath.includes(d))) return;
      
      // Skip non-public apps (e.g., extension-halo)
      if (SKIP_NON_PUBLIC.some(d => relativePath.includes(d))) return;
      
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
        if (affectedFiles.length < 5) {
          affectedFiles.push(relativePath);
        }
      }
    });
  }
  
  if (filesWithChinese > 0) {
    error(`${filesWithChinese} files contain Chinese comments (${totalChineseComments} total)`);
    affectedFiles.forEach((file) => {
      log(`   → ${file}`);
    });
    if (filesWithChinese > 5) {
      log(`   → ... and ${filesWithChinese - 5} more files`);
    }
  } else {
    ok('No Chinese comments in public-facing code');
  }
}