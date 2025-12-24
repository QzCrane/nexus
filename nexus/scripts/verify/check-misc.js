/**
 * 检查依赖方向和其他杂项
 */

import fs from 'fs';
import path from 'path';
import { error, ok, warn } from './utils.js';

export function checkDependencyDirection(ROOT) {
	console.log('\n📋 检查依赖方向...\n');

	// contracts 不应依赖其他包
	const contractsPkg = path.join(ROOT, 'packages/contracts/package.json');
	if (fs.existsSync(contractsPkg)) {
		const pkg = JSON.parse(fs.readFileSync(contractsPkg, 'utf-8'));
		const deps = pkg.dependencies || {};
		const forbidden = Object.keys(deps).filter(d => d.startsWith('@nexus/'));

		if (forbidden.length > 0) {
			error(`contracts 依赖其他 @nexus 包: ${forbidden.join(', ')}`);
		} else {
			ok('contracts 包依赖方向正确');
		}
	}

	// kernel 不应依赖 audio-engine
	const kernelPkg = path.join(ROOT, 'packages/nexus-kernel/package.json');
	if (fs.existsSync(kernelPkg)) {
		const pkg = JSON.parse(fs.readFileSync(kernelPkg, 'utf-8'));
		if (pkg.dependencies?.['@nexus/audio-engine']) {
			error('kernel 依赖 audio-engine！反向依赖');
		} else {
			ok('kernel 包依赖方向正确');
		}
	}
}

export function checkReadmeAI(ROOT) {
	console.log('\n📋 检查 README.AI.md...\n');

	const readmeAI = path.join(ROOT, 'README.AI.md');
	if (!fs.existsSync(readmeAI)) {
		error('README.AI.md 缺失！');
		return;
	}

	ok('README.AI.md 存在');

	const messagesFile = path.join(ROOT, 'packages/contracts/src/messages.contracts.ts');
	if (fs.existsSync(messagesFile)) {
		const messagesContent = fs.readFileSync(messagesFile, 'utf-8');
		const readmeContent = fs.readFileSync(readmeAI, 'utf-8');
		const messageNames = messagesContent.match(/'[A-Z_]+'/g) || [];
		const uniqueMessages = [...new Set(messageNames.map(m => m.replace(/'/g, '')))];

		const missing = uniqueMessages.slice(0, 5).filter(msg => !readmeContent.includes(msg));
		if (missing.length > 0) {
			warn(`README.AI.md 可能缺少: ${missing.join(', ')}`);
		} else {
			ok('消息速查表包含主要消息');
		}
	}
}

export function checkHtmlResources(ROOT) {
	console.log('\n📋 检查 HTML 资源引用...\n');

	const publicDir = path.join(ROOT, 'apps/extension-spectra/public');
	if (!fs.existsSync(publicDir)) return;

	const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
	let issues = [];

	for (const htmlFile of htmlFiles) {
		const content = fs.readFileSync(path.join(publicDir, htmlFile), 'utf-8');

		// 检查 script 引用
		const scriptRefs = content.matchAll(/<script\s+src=["']([^"']+)["']/g);
		for (const match of scriptRefs) {
			const ref = match[1];
			if (ref.startsWith('http') || ref.startsWith('//')) continue;

			const refPath = path.join(publicDir, ref);
			const isPublic = fs.existsSync(refPath);
			const tsPath = ref.replace('.js', '.ts');
			const srcPaths = [
				path.join(ROOT, 'apps/extension-spectra/src', tsPath),
				path.join(ROOT, 'apps/extension-spectra/src', ref.replace('.js', ''), 'index.ts')
			];
			const isBuild = srcPaths.some(p => fs.existsSync(p));

			if (!isPublic && !isBuild) {
				issues.push({ html: htmlFile, ref });
			}
		}
	}

	if (issues.length > 0) {
		for (const issue of issues) {
			error(`${issue.html}: ${issue.ref} 不存在！`);
		}
	} else {
		ok('所有 HTML 资源引用有效');
	}
}
