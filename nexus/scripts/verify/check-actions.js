/**
 * 检查硬编码 Action 字符串
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, warn, scanDir, section } from './utils.js';

// HALO is outside the SPECTRA release scope. Keep its pre-existing literals as
// an explicit, reviewable baseline so this verifier still rejects every new
// hardcoded action in either extension without requiring a HALO source edit.
const GRANDFATHERED_ACTIONS = new Map([
	[
		'apps/extension-halo/src/entry/content.ts',
		new Set([
			'HALO_GET_STATUS',
			'HALO_TOOL_ACTIVATE',
			'HALO_TOOL_DEACTIVATE',
			'HALO_RULER_START',
			'HALO_RULER_CANCEL',
			'HALO_SCROLL_TO_HEADING',
		]),
	],
]);

export function checkHardcodedActions(ROOT) {
	section('检查硬编码 Action 字符串...');

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
	const srcDirs = [
		path.join(ROOT, 'apps/extension-spectra/src'),
		path.join(ROOT, 'apps/extension-halo/src'),
	];

	for (const srcDir of srcDirs) {
		if (!fs.existsSync(srcDir)) continue;
		scanDir(srcDir, (fullPath, entry) => {
			const isTsFile = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
			if (!isTsFile || entry.name.endsWith('.d.ts')) return;

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
				const grandfathered = GRANDFATHERED_ACTIONS.get(relativePath)?.has(action) ?? false;
				if (patterns.some(p => line.includes(p)) && !grandfathered) {
					violations.push({ path: relativePath, line: i + 1, action });
				}
			}
		}
		});
	}

	if (violations.length > 0) {
		for (const v of violations) {
			error(`硬编码 Action: ${v.path}:${v.line} (${v.action})`);
		}
	} else {
		ok(`无硬编码 Action (检查了 ${KNOWN_ACTIONS.length} 个)`);
	}
}
