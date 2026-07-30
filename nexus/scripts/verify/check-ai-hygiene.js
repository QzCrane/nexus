/**
 * 检查 AI 卫生规则 (AI hygiene)
 *
 * 捕获 AI 在重构过程中倾向于重新引入的架构违规：
 *  1. 通过 @nexus/<pkg>/src/... 深路径导入包内部
 *  2. 残留已删除的 branded type (TabId / VolumeLevel / DomainName)
 *  3. 相对 TS 导入缺少 .js 扩展名 (ESM 运行时要求)
 *  4. 引用已删除的 messages.contracts.ts 文件
 *
 * Workspace lint 覆盖由 scripts/check-workspace-lint.mjs 唯一拥有，
 * 此架构检查不维护第二份 package 或 baseline 清单。
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, warn, section } from './utils.js';

/** 扫描时跳过的目录名（避免递归进入 node_modules / dist / 构建产物） */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.turbo', '.cache']);

/** 允许不带 .js 扩展名的静态资源后缀 */
const ALLOWED_ASSET_EXTENSIONS = ['.js', '.json', '.css', '.svg'];

/**
 * 检查 AI 卫生规则入口。
 * @param {string} ROOT - 仓库根目录（nexus/）
 */
export function checkAiHygiene(ROOT) {
	section('检查 AI 卫生规则 (AI hygiene)...');
	checkNoDeepPathImports(ROOT);
	checkNoBrandedTypes(ROOT);
	checkRelativeImportsHaveJsExtension(ROOT);
	checkNoDeletedContractsReferences(ROOT);
}

/**
 * Rule 1: 禁止 @nexus/<pkg>/src/... 深路径导入。
 * 应使用包根导出或 package.json exports 字段声明的子路径。
 */
function checkNoDeepPathImports(ROOT) {
	const violations = [];
	const deepImportRe = /from\s+['"]@nexus\/[^'"]+\/src\//;
	const scanRoots = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')];

	for (const scanRoot of scanRoots) {
		scanSourceTree(scanRoot, (fullPath, entry) => {
			if (!isScannableSourceFile(entry.name)) return;
			if (isTestFile(entry.name)) return;

			const lines = readLines(fullPath);
			for (let i = 0; i < lines.length; i++) {
				const match = lines[i].match(deepImportRe);
				if (match) {
					violations.push({ relPath: relPathOf(fullPath, ROOT), line: i + 1 });
				}
			}
		});
	}

	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: 深路径导入 @nexus/.../src/ — 应使用包根导出`);
		}
		return;
	}

	ok('无深路径导入');
}

/**
 * Rule 3: 禁止残留已删除的 branded type (TabId / VolumeLevel / DomainName)。
 * 这些类型已迁移为 number/string 原语；任何残留引用均为违规。
 */
function checkNoBrandedTypes(ROOT) {
	const violations = [];
	const brandedTypeRe = /\b(TabId|VolumeLevel|DomainName)\b/;
	const scanRoots = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')];

	for (const scanRoot of scanRoots) {
		scanSourceTree(scanRoot, (fullPath, entry) => {
			if (!isScannableSourceFile(entry.name)) return;

			const lines = readLines(fullPath);
			for (let i = 0; i < lines.length; i++) {
				const match = lines[i].match(brandedTypeRe);
				if (match) {
					violations.push({ relPath: relPathOf(fullPath, ROOT), line: i + 1, name: match[1] });
				}
			}
		});
	}

	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: branded type ${v.name} 已删除，使用 number/string 替代`);
		}
		return;
	}

	ok('无 branded type 残留');
}

/**
 * Rule 4: 相对 TS 导入必须带 .js 扩展名（ESM 运行时要求）。
 * 由于历史违规较多，仅发出 warn 而非 error；逐行跳过 `// biome-ignore` 标记。
 */
function checkRelativeImportsHaveJsExtension(ROOT) {
	let count = 0;
	const relativeImportRe = /from\s+['"](\.\.?\/[^'"]+)['"]/;
	const scanRoots = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')];

	for (const scanRoot of scanRoots) {
		scanSourceTree(scanRoot, (fullPath, entry) => {
			if (!isScannableSourceFile(entry.name)) return;
			if (isTestFile(entry.name)) return;

			const isTsx = entry.name.endsWith('.tsx');
			const lines = readLines(fullPath);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.includes('// biome-ignore')) continue;

				const match = line.match(relativeImportRe);
				if (!match) continue;

				const importPath = match[1];
				if (hasAllowedRelativeExtension(importPath, isTsx, /* isTestFile */ false)) continue;

				count++;
			}
		});
	}

	if (count > 0) {
		warn(`${count} relative imports missing .js extension (use .js for runtime ESM)`);
	}
}

/**
 * Rule 5: 禁止引用已删除的 messages.contracts.ts。
 * 真实引用通常出现在 import 或 path.join 上下文中，要求路径分隔符前缀以避免
 * 误报 skipFiles 数组中的裸文件名条目。
 */
function checkNoDeletedContractsReferences(ROOT) {
	const violations = [];
	// 调整原 `messages\.contracts` 模式：要求前导路径分隔符，避免匹配 skipFiles 中的裸文件名。
	const deletedRefRe = /[/\\]messages\.contracts/;

	scanSourceTree(ROOT, (fullPath, entry) => {
		if (!isScannableScriptFile(entry.name)) return;

		const lines = readLines(fullPath);
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].match(deletedRefRe)) {
				violations.push({ relPath: relPathOf(fullPath, ROOT), line: i + 1 });
			}
		}
	});

	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: 引用已删除的 messages.contracts.ts — 使用 messages/index.ts`);
		}
		return;
	}

	ok('无 messages.contracts 引用');
}

/** 判定文件是否为可扫描的 .ts/.tsx 源文件（排除 .d.ts） */
function isScannableSourceFile(name) {
	return (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts');
}

/**
 * 递归扫描目录，跳过 SKIP_DIR_NAMES 中的子目录。
 * 与 utils.scanDir 不同，本扫描器不会递归进入 node_modules/dist 等噪声目录。
 */
function scanSourceTree(dir, callback) {
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIR_NAMES.has(entry.name)) continue;
			scanSourceTree(fullPath, callback);
		} else if (entry.isFile()) {
			callback(fullPath, entry);
		}
	}
}

/** 判定文件是否为可扫描的脚本文件（.ts/.tsx/.js/.mjs，排除 .d.ts） */
function isScannableScriptFile(name) {
	return (
		(name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.mjs')) &&
		!name.endsWith('.d.ts')
	);
}

/** 判定是否为测试文件（spec.ts/test.ts） */
function isTestFile(name) {
	return name.endsWith('.spec.ts') || name.endsWith('.test.ts');
}

/** 读取文件并按行切分 */
function readLines(fullPath) {
	return fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/u);
}

/** 计算相对仓库根的 Unix 风格路径 */
function relPathOf(fullPath, ROOT) {
	return fullPath.replace(ROOT + path.sep, '').replace(/\\/g, '/');
}

/**
 * 判定相对导入路径是否使用了允许的扩展名。
 * - `.js`/`.json`/`.css`/`.svg` 始终允许
 * - `.tsx` 仅在导入方为 .tsx 文件时允许
 * - `.ts` 仅在测试文件（bun:test）中允许
 */
function hasAllowedRelativeExtension(importPath, isTsxImporter, isTestImporter) {
	const ext = path.extname(importPath);
	if (ALLOWED_ASSET_EXTENSIONS.includes(ext)) return true;
	if (ext === '.tsx' && isTsxImporter) return true;
	if (ext === '.ts' && isTestImporter) return true;
	return false;
}
