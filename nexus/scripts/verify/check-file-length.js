/**
 * 检查源码文件行数
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn, scanDir } from './utils.js';

const MAX_LINES = 200;
const WARN_LINES = 150;

// 历史技术债豁免列表
const LEGACY_FILES = [
	'packages/contracts/src/messages.contracts.ts',
	'packages/nexus-kernel/src/storage/repository.ts',
	'packages/features/audio-engine/src/constants.ts',
	'packages/features/audio-engine/src/PolicyEngine.ts',
	'packages/features/audio-engine/src/WebAudioController.ts',
	// Auto-generated files (by pnpm generate-registry)
	'apps/extension-halo/src/kernel/registry/_generated.ts',
	'apps/extension-halo/src/components/_generated-tool-loader.ts',
	// i18n module translations (data files, not logic)
	'apps/extension-halo/src/i18n/locales/en-modules/modules.ts',
	'apps/extension-halo/src/i18n/locales/zh-modules/modules.ts',
];

export function checkSourceFileLength(ROOT) {
	console.log('\n📋 检查源码文件行数 (推荐≤150, 上限200)...\n');

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
				if (LEGACY_FILES.includes(relativePath)) {
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

	// 150-200 行 → 警告
	for (const file of warnFiles) {
		warn(`${file.path} 超过 ${WARN_LINES} 行 (当前 ${file.lines} 行)，建议拆分`);
	}

	// 历史债务 → 警告
	for (const file of legacyFiles) {
		warn(`[历史债务] ${file.path} (${file.lines} 行)`);
	}

	if (oversizeFiles.length === 0) {
		ok('无新增超标文件');
	}
}
