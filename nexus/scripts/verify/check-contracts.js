/**
 * 检查 contracts 包纯净性
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn, section } from './utils.js';

export function checkContractsPurity(ROOT) {
	section('检查 contracts 包纯净性...');

	const packageJson = path.join(ROOT, 'packages/contracts/package.json');
	if (!fs.existsSync(packageJson)) {
		error('packages/contracts/package.json 不存在！');
		return;
	}

	const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));

	if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
		error(`contracts 包有 dependencies: ${JSON.stringify(pkg.dependencies)}`);
	} else {
		ok('contracts 包没有 runtime dependencies');
	}

	// 检查是否有实现代码
	const srcDir = path.join(ROOT, 'packages/contracts/src');
	if (fs.existsSync(srcDir)) {
		const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
		for (const file of files) {
			const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
			if (content.includes('function ') && !content.includes('type ') && !content.includes('interface ')) {
				warn(`contracts/${file} 可能包含实现代码`);
			}
		}
	}
}
