/**
 * 检查 contracts 包纯净性
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section } from './utils.ts';

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

	// Runtime validators and canonical normalizers are part of the wire contract.
	// Purity is enforced through the dependency boundary above; a blanket ban on
	// functions would force every process to duplicate validation logic.
	ok('contracts 包允许无依赖的运行时校验与规范化函数');
}