/**
 * 检查硬编码 Action 字符串
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn, scanDir } from './utils.js';

export function checkHardcodedActions(ROOT) {
	console.log('\n📋 检查硬编码 Action 字符串...\n');

	const actionsFile = path.join(ROOT, 'packages/contracts/src/actions.ts');
	if (!fs.existsSync(actionsFile)) {
		warn('actions.ts 不存在，跳过检查');
		return;
	}

	const actionsContent = fs.readFileSync(actionsFile, 'utf-8');
	const actionMatches = actionsContent.match(/'[A-Z_]+'/g) || [];
	const KNOWN_ACTIONS = [...new Set(actionMatches.map(m => m.replace(/'/g, '')))];

	if (KNOWN_ACTIONS.length === 0) {
		warn('未能从 actions.ts 解析出 Action 列表');
		return;
	}

	const violations = [];
	const skipFiles = ['actions.ts', 'messages.contracts.ts', 'definitions.ts'];

	scanDir(path.join(ROOT, 'apps/extension-spectra/src'), (fullPath, entry) => {
		if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return;

		const relativePath = fullPath.replace(ROOT + path.sep, '').replace(/\\/g, '/');
		if (skipFiles.some(f => relativePath.includes(f))) return;

		const content = fs.readFileSync(fullPath, 'utf-8');
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const action of KNOWN_ACTIONS) {
				const patterns = [
					`action: '${action}'`,
					`action: "${action}"`,
					`case '${action}':`,
					`case "${action}":`
				];
				if (patterns.some(p => line.includes(p))) {
					violations.push({ path: relativePath, line: i + 1, action });
				}
			}
		}
	});

	if (violations.length > 0) {
		for (const v of violations) {
			error(`硬编码 Action: ${v.path}:${v.line} (${v.action})`);
		}
	} else {
		ok(`无硬编码 Action (检查了 ${KNOWN_ACTIONS.length} 个)`);
	}
}
