/**
 * Check source file length
 * Ensures source files don't exceed recommended line limits
 */

import fs from 'node:fs';
import path from 'node:path';
import { ok, scanDir, log, warn, section } from './utils.js';

const MAX_LINES = 1000;
const SKIP_DIRS = /[/\\](node_modules|dist|\.turbo|\.git|build|coverage)[/\\]/;

export function checkSourceFileLength(root) {
	section('检查源文件长度...');

	let warnings = 0;
	let checked = 0;

	scanDir(root, (fullPath) => {
		if (SKIP_DIRS.test(fullPath)) return;
		// Only check .ts/.tsx files under a src/ directory.
		if (!/[/\\]src[/\\].*\.tsx?$/.test(fullPath)) return;
		checked++;
		const content = fs.readFileSync(fullPath, 'utf8');
		const lines = content.split('\n').length;
		if (lines > MAX_LINES) {
			const relative = path.relative(root, fullPath).replace(/\\/g, '/');
			warn(`${relative}: ${lines} 行 (超过 ${MAX_LINES})`);
			warnings++;
		}
	});

	if (warnings > 0) {
		log(`  (info) ${warnings} 个文件超过 ${MAX_LINES} 行`);
	} else {
		ok(`源文件长度检查通过 (扫描 ${checked} 个文件)`);
	}
}
