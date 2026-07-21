/**
 * Check AI context documentation files
 * Ensures AGENTS.md exists and each docs/principles/*.md has frontmatter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, scanDir, section } from './utils.js';

export function checkAiContextFiles(root) {
	section('检查 AI 上下文文件...');

	// AGENTS.md lives at the repository root (one level above the nexus workspace).
	const agentsFile = path.join(root, '..', 'AGENTS.md');
	if (!fs.existsSync(agentsFile)) {
		error('AGENTS.md 缺失（AI 上下文入口）');
	} else {
		ok('AGENTS.md 存在');
	}

	// Each docs/principles/*.md must start with a frontmatter block.
	const principlesDir = path.join(root, 'docs', 'principles');
	if (!fs.existsSync(principlesDir)) {
		error('docs/principles/ 目录缺失');
		return;
	}

	let checked = 0;
	let missing = 0;
	scanDir(principlesDir, (fullPath, entry) => {
		if (!entry.name.endsWith('.md')) return;
		checked++;
		const content = fs.readFileSync(fullPath, 'utf8');
		if (!content.startsWith('---')) {
			error(`${path.relative(root, fullPath)} 缺少 frontmatter`);
			missing++;
		}
	});

	if (checked === 0) {
		error('docs/principles/ 下没有 .md 文件');
	} else if (missing === 0) {
		ok(`docs/principles/ 下 ${checked} 个文件均含 frontmatter`);
	}
}
