/**
 * 架构验证工具函数
 */

import fs from 'fs';
import path from 'path';

// 颜色输出
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** 错误和警告计数器 */
export const counters = { errors: 0, warnings: 0 };

export function error(msg) {
	console.log(`${RED}❌ ERROR${RESET}: ${msg}`);
	counters.errors++;
}

export function warn(msg) {
	console.log(`${YELLOW}⚠️  WARN${RESET}: ${msg}`);
	counters.warnings++;
}

export function ok(msg) {
	console.log(`${GREEN}✅ OK${RESET}: ${msg}`);
}

/** 递归扫描目录 */
export function scanDir(dir, callback) {
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			scanDir(fullPath, callback);
		} else {
			callback(fullPath, entry);
		}
	}
}
