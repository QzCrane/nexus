/**
 * 检查 .ai-context.md 文件
 * 软限位: 目标 ≤40 行，警告 >50 行，错误 >80 行
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn, section } from './utils.js';

const SOFT_LIMIT = 40;  // 目标行数 (超过仅提示)
const WARN_LINES = 50;  // 警告阈值
const ERROR_LINES = 80; // 错误阈值 (信息过于冗长)

export function checkAiContextFiles(ROOT) {
	section('检查 .ai-context.md 文件...');

	const dirsToScan = [
		{ base: 'packages', depth: 1 },
		{ base: 'packages/features', depth: 1 },
		{ base: 'apps', depth: 1 }
	];

	for (const { base } of dirsToScan) {
		const basePath = path.join(ROOT, base);
		if (!fs.existsSync(basePath)) continue;

		const entries = fs.readdirSync(basePath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (['node_modules', 'dist', 'contracts'].includes(entry.name)) continue;

			const pkgPath = path.join(basePath, entry.name);
			const contextFile = path.join(pkgPath, '.ai-context.md');
			const packageJson = path.join(pkgPath, 'package.json');

			if (!fs.existsSync(packageJson)) continue;

			if (fs.existsSync(contextFile)) {
				const content = fs.readFileSync(contextFile, 'utf-8');
				const lineCount = content.split('\n').length;
				if (lineCount > ERROR_LINES) {
					error(`${base}/${entry.name}/.ai-context.md 超过 ${ERROR_LINES} 行 (当前 ${lineCount} 行)，信息过于冗长！`);
				} else if (lineCount > WARN_LINES) {
					warn(`${base}/${entry.name}/.ai-context.md 超过 ${WARN_LINES} 行 (当前 ${lineCount} 行)，建议压缩`);
				} else {
					ok(`${base}/${entry.name}/.ai-context.md (${lineCount} 行)`);
				}
			} else {
				error(`${base}/${entry.name}/.ai-context.md 缺失！`);
			}
		}
	}
}
