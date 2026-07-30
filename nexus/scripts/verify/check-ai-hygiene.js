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
 *
 * 扫描策略：
 *  - apps/+packages/ 一次遍历，对每个源文件读一次，按行应用 rule 1/2/3/4 全部检查
 *  - ROOT 一次补充遍历（仅 .js/.mjs，跳过 apps/+packages 子树），仅应用 rule 4
 *  这把原 4 次重复扫描合并为 2 次（apps+packages ×1，ROOT ×1），同时保留原覆盖范围。
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, warn, section } from './utils.js';

/** 扫描时跳过的目录名（避免递归进入 node_modules / dist / 构建产物） */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.turbo', '.cache']);

/** ROOT 补充扫描时额外跳过的目录（apps/+packages 已在主扫描覆盖） */
const ROOT_SCAN_EXTRA_SKIP = new Set(['apps', 'packages']);

/** 允许不带 .js 扩展名的静态资源后缀 */
const ALLOWED_ASSET_EXTENSIONS = ['.js', '.json', '.css', '.svg'];

/**
 * 检查 AI 卫生规则入口。
 * @param {string} ROOT - 仓库根目录（nexus/）
 */
export function checkAiHygiene(ROOT) {
	section('检查 AI 卫生规则 (AI hygiene)...');

	const deepImportRe = /from\s+['"]@nexus\/[^'"]+\/src\//;
	const brandedTypeRe = /\b(TabId|VolumeLevel|DomainName)\b/;
	const relativeImportRe = /from\s+['"](\.\.?\/[^'"]+)['"]/;
	const deletedRefRe = /[/\\]messages\.contracts/;

	const deepImportViolations = [];
	const brandedTypeViolations = [];
	const deletedContractsViolations = [];
	let relativeImportWarnings = 0;

	// 主扫描：apps/+packages 一次遍历，应用 rule 1/2/3/4
	const sourceScanRoots = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')];
	for (const scanRoot of sourceScanRoots) {
		scanSourceTree(scanRoot, (fullPath, entry) => {
			if (!isScannableSourceFile(entry.name)) return;
			const isTest = isTestFile(entry.name);
			const isTsx = entry.name.endsWith('.tsx');
			const relPath = relPathOf(fullPath, ROOT);

			const lines = readLines(fullPath);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// Rule 1: 深路径导入（跳过测试文件）
				if (!isTest && line.match(deepImportRe)) {
					deepImportViolations.push({ relPath, line: i + 1 });
				}

				// Rule 2: branded type 残留（所有源文件）
				const brandedMatch = line.match(brandedTypeRe);
				if (brandedMatch) {
					brandedTypeViolations.push({ relPath, line: i + 1, name: brandedMatch[1] });
				}

				// Rule 3: 相对导入缺 .js 扩展名（跳过测试文件 + biome-ignore 行）
				if (!isTest && !line.includes('// biome-ignore')) {
					const relMatch = line.match(relativeImportRe);
					if (relMatch && !hasAllowedRelativeExtension(relMatch[1], isTsx, false)) {
						relativeImportWarnings++;
					}
				}

				// Rule 4: 引用已删除的 messages.contracts（所有源文件均属于脚本文件范畴）
				if (line.match(deletedRefRe)) {
					deletedContractsViolations.push({ relPath, line: i + 1 });
				}
			}
		});
	}

	// 补充扫描：ROOT 范围内的 .js/.mjs（跳过 apps/+packages 子树），仅应用 rule 4
	scanSourceTree(ROOT, (fullPath, entry) => {
		if (!isScannableScriptFile(entry.name)) return;
		// 跳过 .ts/.tsx（已在主扫描覆盖）；仅扫 .js/.mjs
		if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) return;

		const relPath = relPathOf(fullPath, ROOT);
		const lines = readLines(fullPath);
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].match(deletedRefRe)) {
				deletedContractsViolations.push({ relPath, line: i + 1 });
			}
		}
	}, ROOT_SCAN_EXTRA_SKIP);

	reportDeepImports(deepImportViolations);
	reportBrandedTypes(brandedTypeViolations);
	reportRelativeImports(relativeImportWarnings);
	reportDeletedContracts(deletedContractsViolations);
}

function reportDeepImports(violations) {
	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: 深路径导入 @nexus/.../src/ — 应使用包根导出`);
		}
		return;
	}
	ok('无深路径导入');
}

function reportBrandedTypes(violations) {
	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: branded type ${v.name} 已删除，使用 number/string 替代`);
		}
		return;
	}
	ok('无 branded type 残留');
}

function reportRelativeImports(count) {
	if (count > 0) {
		warn(`${count} relative imports missing .js extension (use .js for runtime ESM)`);
	}
}

function reportDeletedContracts(violations) {
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

/**
 * 递归扫描目录，跳过 SKIP_DIR_NAMES 中的子目录。
 * 与 utils.scanDir 不同，本扫描器不会递归进入 node_modules/dist 等噪声目录。
 * @param {string} dir - 扫描根目录
 * @param {(fullPath: string, entry: fs.Dirent) => void} callback - 文件回调
 * @param {Set<string>} [extraSkipDirs] - 额外跳过的目录名（如 ROOT 扫描时跳过 apps/packages）
 */
function scanSourceTree(dir, callback, extraSkipDirs) {
	if (!fs.existsSync(dir)) return;
	const skip = extraSkipDirs ? new Set([...SKIP_DIR_NAMES, ...extraSkipDirs]) : SKIP_DIR_NAMES;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (skip.has(entry.name)) continue;
			scanSourceTree(fullPath, callback, extraSkipDirs);
		} else if (entry.isFile()) {
			callback(fullPath, entry);
		}
	}
}
