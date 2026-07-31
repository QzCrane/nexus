/**
 * 检查 src 目录纯度：禁止编译产物混入源码目录
 *
 * 根因：contracts 包的 src/ 下曾遗留 39 个编译产物（.js/.js.map/.d.ts.map），
 * Bun 通过 tsconfig paths 解析 @nexus/contracts 到 src/ 时优先加载旧 .js 而非 .ts，
 * 导致新增导出在测试运行时不可见。此检查防止编译产物再次混入 src。
 *
 * 规则：
 * - .js.map / .d.ts.map 在 src 下总是非法（纯编译产物）
 * - .js 文件如果同目录有同名 .ts 源文件，判定为编译产物（非法）
 * - 无对应 .ts 的 .js 文件允许（如 HALO 用户脚本 script.js）
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section } from './utils.ts';

const SOURCE_ROOTS = ['packages', 'apps'];

// 编译产物扩展名（在 src 下总是非法）
const COMPILED_MAP_EXTENSIONS = ['.js.map', '.d.ts.map'];

function walkSrc(rootDir: string, callback: (filePath: string) => void): void {
	if (!fs.existsSync(rootDir)) return;
	for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'src') {
				walkDir(fullPath, callback);
			} else {
				walkSrc(fullPath, callback);
			}
		}
	}
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist') continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkDir(fullPath, callback);
		} else if (entry.isFile()) {
			callback(fullPath);
		}
	}
}

export function checkSourcePurity(ROOT: string) {
	section('检查 src 目录纯度（禁止编译产物）...');

	let violations = 0;

	for (const sourceRoot of SOURCE_ROOTS) {
		const rootDir = path.join(ROOT, sourceRoot);
		walkSrc(rootDir, (filePath) => {
			const ext = path.extname(filePath);
			const fileName = path.basename(filePath);

			// 检查 .js.map / .d.ts.map（总是非法）
			for (const mapExt of COMPILED_MAP_EXTENSIONS) {
				if (fileName.endsWith(mapExt)) {
					error(`src 下存在编译产物: ${path.relative(ROOT, filePath)}`);
					violations++;
					return;
				}
			}

			// 检查 .js 文件是否有同名 .ts 源文件（编译产物标志）
			if (ext === '.js') {
				const tsSibling = `${filePath.slice(0, -3)}.ts`;
				if (fs.existsSync(tsSibling)) {
					error(`src 下存在编译产物（有同名 .ts）: ${path.relative(ROOT, filePath)}`);
					violations++;
				}
			}
		});
	}

	if (violations === 0) {
		ok('src 目录无编译产物污染');
	}
}
