/**
 * 跨平台清理 src 下的编译产物、dist 目录和 .tsbuildinfo 文件
 *
 * 根因 1：tsc 在某些配置下可能将编译产物输出到 src/ 而非 dist/，
 * Bun 通过 tsconfig paths 解析 @nexus/* 到 src/ 时优先加载旧 .js 而非 .ts，
 * 导致新增导出在测试运行时不可见。
 *
 * 根因 2：composite/incremental 模式下 tsc 生成 .tsbuildinfo 增量状态文件。
 * 如果 clean 只删 dist 但保留 .tsbuildinfo，tsc 会误判"已是最新"而跳过生成，
 * 导致 dist 缺失、下游包 TS6305 错误。必须同步清理 .tsbuildinfo。
 *
 * 用法: bun scripts/clean-build-artifacts.ts <package-path>
 * 例如: bun scripts/clean-build-artifacts.ts packages/contracts
 */

import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
	console.error('Usage: bun scripts/clean-build-artifacts.ts <package-path>');
	process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const pkgDir = path.resolve(ROOT, target);
const srcDir = path.join(pkgDir, 'src');
const distDir = path.join(pkgDir, 'dist');

let cleaned = 0;

// 清理 src 下的编译产物
if (fs.existsSync(srcDir)) {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const name = entry.name;
		// 编译产物：.js, .js.map, .d.ts, .d.ts.map（但保留 .ts 源文件）
		if (name.endsWith('.js') || name.endsWith('.js.map') || name.endsWith('.d.ts') || name.endsWith('.d.ts.map')) {
			// 只删除有对应 .ts 源文件的 .js（编译产物），保留独立 .js（如用户脚本）
			if (name.endsWith('.js')) {
				const tsSibling = path.join(srcDir, `${name.slice(0, -3)}.ts`);
				if (!fs.existsSync(tsSibling)) continue;
			}
			fs.unlinkSync(path.join(srcDir, name));
			cleaned++;
		}
	}
}

// 清理 dist 目录
if (fs.existsSync(distDir)) {
	fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	cleaned++;
}

// 清理 .tsbuildinfo 增量状态文件（composite/incremental 产物）
// 必须与 dist 同步清理，否则 tsc 误判最新而跳过生成
for (const infoFile of ['tsconfig.tsbuildinfo', 'typecheck.tsbuildinfo']) {
	const infoPath = path.join(pkgDir, infoFile);
	if (fs.existsSync(infoPath)) {
		fs.unlinkSync(infoPath);
		cleaned++;
	}
}

if (cleaned > 0) {
	console.log(`clean: removed ${cleaned} build artifact(s) from ${target}`);
} else {
	console.log(`clean: ${target} already clean`);
}
