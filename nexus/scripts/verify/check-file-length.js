/**
 * 检查源码文件行数
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn, summary, scanDir } from './utils.js';

const MAX_LINES = 200;
const WARN_LINES = 150;

// 历史技术债豁免列表
const LEGACY_FILES = [
	'packages/contracts/src/messages.contracts.ts',
	'packages/nexus-kernel/src/storage/repository.ts',
	'packages/features/audio-engine/src/constants.ts',
	'packages/features/audio-engine/src/PolicyEngine.ts',
	'packages/features/audio-engine/src/WebAudioController.ts',
	// Auto-generated files
	'apps/extension-halo/src/kernel/registry/_generated.ts',
	'apps/extension-halo/src/components/_generated-tool-loader.ts',
	// i18n data files
	'apps/extension-halo/src/i18n/locales/en-modules/modules.ts',
	'apps/extension-halo/src/i18n/locales/zh-modules/modules.ts',
	// Complex system panels
	'apps/extension-halo/src/system/userscripts/panel.tsx',
	// Core services
	'apps/extension-halo/src/kernel/services/saat-service.ts',
];

// 目录级豁免 (规则定义文件需要较长)
const EXEMPT_DIRS = [
	'apps/extension-halo/src/tools/hover-zoom/rules/definitions/',
];


export function checkSourceFileLength(ROOT) {
	console.log('\n📋 检查文件行数...');

	const srcDirs = [
		'packages/contracts/src',
		'packages/nexus-kernel/src',
		'packages/features/audio-engine/src',
		'apps/extension-spectra/src',
		'apps/extension-halo/src'
	];

	let oversizeFiles = [];
	let warnFiles = [];
	let legacyFiles = [];

	for (const srcDir of srcDirs) {
		scanDir(path.join(ROOT, srcDir), (fullPath, entry) => {
			const isTsFile = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
			if (!isTsFile || entry.name.endsWith('.d.ts')) return;

			const content = fs.readFileSync(fullPath, 'utf-8');
			const lineCount = content.split('\n').length;
			const relativePath = fullPath.replace(ROOT + path.sep, '').replace(/\\/g, '/');

			if (lineCount > MAX_LINES) {
			// Check directory-level exemptions
			const isExemptDir = EXEMPT_DIRS.some(dir => relativePath.startsWith(dir));
			if (LEGACY_FILES.includes(relativePath) || isExemptDir) {
				legacyFiles.push({ path: relativePath, lines: lineCount });
			} else {
				oversizeFiles.push({ path: relativePath, lines: lineCount });
			}
			} else if (lineCount > WARN_LINES) {
				warnFiles.push({ path: relativePath, lines: lineCount });
			}
		});
	}

	// 新增超标 → 错误
	for (const file of oversizeFiles) {
		error(`${file.path} 超过 ${MAX_LINES} 行 (当前 ${file.lines} 行)！`);
	}

	// 统计警告（不打印详情）
	for (const file of warnFiles) {
		warn(`${file.path} (${file.lines} 行)`, true); // silent
	}
	for (const file of legacyFiles) {
		warn(`[legacy] ${file.path} (${file.lines} 行)`, true); // silent
	}

	// 汇总输出
	if (oversizeFiles.length === 0) {
		const totalWarn = warnFiles.length + legacyFiles.length;
		if (totalWarn > 0) {
			console.log(`   ⚠️  ${warnFiles.length} 文件超 150 行, ${legacyFiles.length} 历史债务 (用 --verbose 查看)`);
		} else {
			ok('文件行数检查通过');
		}
	}
}
