/**
 * 检查 AI 卫生规则 (AI hygiene)
 *
 * 捕获 AI 在重构过程中倾向于重新引入的架构违规：
 *  1. 通过 @nexus/<pkg>/src/... 深路径导入包内部
 *  2. 残留已删除的 branded type (TabId / VolumeLevel / DomainName)
 *  3. 引用已删除的 messages.contracts.ts 文件
 *  4. 仓库保持 bundler 模块解析；应用和包源码由构建器解析无扩展名相对导入
 *
 * Workspace lint 覆盖由 scripts/check-workspace-lint.ts 唯一拥有，
 * 此架构检查不维护第二份 package 或 baseline 清单。
 *
 * 扫描策略：
 *  - apps/+packages/ 一次遍历，对每个源文件读一次，按行应用 rule 1/2/3
 *  - ROOT 一次补充遍历（仅 .js/.ts，跳过 apps/+packages 子树），仅应用 rule 3
 *  这把原 4 次重复扫描合并为 2 次（apps+packages ×1，ROOT ×1），同时保留原覆盖范围。
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section } from './utils.ts';

/** 扫描时跳过的目录名（避免递归进入 node_modules / dist / 构建产物） */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.turbo', '.cache']);

/** ROOT 补充扫描时额外跳过的目录（apps/+packages 已在主扫描覆盖） */
const ROOT_SCAN_EXTRA_SKIP = new Set(['apps', 'packages']);

/**
 * 检查 AI 卫生规则入口。
 * @param {string} ROOT - 仓库根目录（nexus/）
 */
export function checkAiHygiene(ROOT) {
	section('检查 AI 卫生规则 (AI hygiene)...');

	const deepImportRe = /from\s+['"]@nexus\/[^'"]+\/src\//;
	const brandedTypeRe = /\b(TabId|VolumeLevel|DomainName)\b/;
	const deletedRefRe = /[/\\]messages\.contracts/;

	const deepImportViolations = [];
	const brandedTypeViolations = [];
	const deletedContractsViolations = [];

	// 主扫描：apps/+packages 一次遍历，应用 rule 1/2/3
	const sourceScanRoots = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')];
	for (const scanRoot of sourceScanRoots) {
		scanSourceTree(scanRoot, (fullPath, entry) => {
			if (!isScannableSourceFile(entry.name)) return;
			const isTest = isTestFile(entry.name);
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

				// Rule 3: 引用已删除的 messages.contracts（所有源文件均属于脚本文件范畴）
				if (line.match(deletedRefRe)) {
					deletedContractsViolations.push({ relPath, line: i + 1 });
				}
			}
		});
	}

	// 补充扫描：ROOT 范围内的 .js/.ts（跳过 apps/+packages 子树），仅应用 rule 4
	scanSourceTree(ROOT, (fullPath, entry) => {
		if (!isScannableScriptFile(entry.name)) return;
		// 跳过 .ts/.tsx（已在主扫描覆盖）；仅扫 .js/.ts
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
	reportDeletedContracts(deletedContractsViolations);
	reportBundlerResolution(ROOT);
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

function reportDeletedContracts(violations) {
	if (violations.length > 0) {
		for (const v of violations) {
			error(`${v.relPath}:${v.line}: 引用已删除的 messages.contracts.ts — 使用 messages/index.ts`);
		}
		return;
	}
	ok('无 messages.contracts 引用');
}

function reportBundlerResolution(ROOT) {
	const configPath = path.join(ROOT, 'tsconfig.base.json');
	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	if (config.compilerOptions?.moduleResolution !== 'bundler') {
		error('tsconfig.base.json must keep moduleResolution=bundler before extensionless imports are valid');
		return;
	}
	ok('无扩展名相对导入由 moduleResolution=bundler 与生产构建共同拥有');
}

/** 判定文件是否为可扫描的 .ts/.tsx 源文件（排除 .d.ts） */
function isScannableSourceFile(name) {
	return (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts');
}

/** 判定文件是否为可扫描的脚本文件（.ts/.tsx/.js/.ts，排除 .d.ts） */
function isScannableScriptFile(name) {
	return (
		(name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.ts')) &&
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
