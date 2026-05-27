/**
 * Check AI context documentation files
 * Ensures .ai-context.md files exist for each module
 */

import fs from 'fs';
import path from 'path';
import { error, ok, scanDir, log } from './utils.js';

export function checkAiContextFiles(root) {
  // Placeholder: AI context check is currently optional
  // Will be re-enabled in a future version
}