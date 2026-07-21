/**
 * 检查依赖方向和其他杂项
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, warn, section } from './utils.js';

export function checkDependencyDirection(ROOT) {
	section('检查依赖方向...');

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
	section('检查 README.md (AI 入口) ...');

	// 自 v2.5+ 起, README.AI.md 已合并入 README.md
	const readme = path.join(ROOT, 'README.md');
	if (!fs.existsSync(readme)) {
		error('README.md 缺失！');
		return;
	}

	ok('README.md 存在');

	const messagesIndex = path.join(ROOT, 'packages/contracts/src/messages/index.ts');
	if (!fs.existsSync(messagesIndex)) {
		return;
	}
	const messagesContent = fs.readFileSync(messagesIndex, 'utf-8');
	const readmeContent = fs.readFileSync(readme, 'utf-8');
	const messageNames = messagesContent.match(/'[A-Z_]+'/g) || [];
	const uniqueMessages = [...new Set(messageNames.map(m => m.replace(/'/g, '')))];

	const missing = uniqueMessages.slice(0, 5).filter(msg => !readmeContent.includes(msg));
	if (missing.length > 0) {
		warn(`README.md 可能缺少: ${missing.join(', ')}`);
	} else {
		ok('消息速查表包含主要消息');
	}
}

export function checkHtmlResources(ROOT) {
	section('检查 HTML 资源引用...');

	const apps = ['extension-spectra', 'extension-halo'];
	const allIssues = [];

	for (const app of apps) {
		const publicDir = path.join(ROOT, 'apps', app, 'public');
		if (!fs.existsSync(publicDir)) continue;

		const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

		for (const htmlFile of htmlFiles) {
			const content = fs.readFileSync(path.join(publicDir, htmlFile), 'utf-8');

			// 检查 script 引用
			const scriptRefs = content.matchAll(/<script\s+src=["']([^"']+)["']/g);
			for (const match of scriptRefs) {
				const ref = match[1];
				if (ref.startsWith('http') || ref.startsWith('//')) continue;

				const refPath = path.join(publicDir, ref);
				const isPublic = fs.existsSync(refPath);
				const baseName = ref.replace('.js', '');
				const tsPath = ref.replace('.js', '.ts');
				const tsxPath = ref.replace('.js', '.tsx');
				const srcPaths = [
					path.join(ROOT, 'apps', app, 'src', tsPath),
					path.join(ROOT, 'apps', app, 'src', tsxPath),
					path.join(ROOT, 'apps', app, 'src', baseName, 'index.ts'),
					path.join(ROOT, 'apps', app, 'src', baseName, 'index.tsx'),
					// Some production-only local vendor entries are deliberately emitted
					// from a feature directory instead of copied into public/. Treat the
					// matching source entry as the HTML resource owner without requiring a
					// duplicate, unminified public artifact.
					path.join(ROOT, 'apps', app, 'src', 'offscreen-remote', tsPath),
					path.join(ROOT, 'apps', app, 'src', 'offscreen-remote', tsxPath),
					// HALO uses entry/ directory
					path.join(ROOT, 'apps', app, 'src', 'entry', tsPath),
					path.join(ROOT, 'apps', app, 'src', 'entry', tsxPath),
				];
				const isBuild = srcPaths.some(p => fs.existsSync(p));

				if (!isPublic && !isBuild) {
					allIssues.push({ app, html: htmlFile, ref });
				}
			}
		}
	}

	if (allIssues.length > 0) {
		for (const issue of allIssues) {
			error(`[${issue.app}] ${issue.html}: ${issue.ref} 不存在！`);
		}
	} else {
		ok('所有 HTML 资源引用有效');
	}
}

