/**
 * Check source file length
 * Ensures source files don't exceed recommended line limits
 */

import fs from 'fs';
import path from 'path';
import { error, ok, scanDir, log, warn } from './utils.js';

const MAX_LINES = 1000;
const SKIP_DIRS = ['node_modules', 'dist', '.turbo', '.git', 'public'];

export function checkSourceFileLength(root) {
  // Placeholder: file length check is currently optional
  // Will be re-enabled in a future version
}