// goal: every request the Content bundle can issue has a response branch in the
// slim contract entry that the build actually gives it
//
// The Content bundle aliases `@nexus/contracts` to spectra.content-runtime.ts
// (apps/extension-spectra/build.ts). That file validates inbound responses with a
// hand-maintained branch list and returns false for anything it does not name, so a
// request type Content uses but the list omits fails on every well-formed response -
// in the shipped bundle only. Unit tests import the complete protocol module, so the
// gap stayed green.
//
// Two live gaps were found this way: spectra.content.default-hotkey.trigger and
// spectra.audio.page-scale.record were issued from bootstrap and native-media-executor
// while the slim validator rejected their acknowledgements outright.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const SLIM_ENTRY = 'packages/contracts/src/spectra.content-runtime.ts';
const CONTENT_ROOT = 'apps/extension-spectra/src/content';

/**
 * Call shapes that send a typed request from Content and then validate its answer.
 *
 * `sendBootstrapRequest` is deliberately absent: it wraps a bare
 * chrome.runtime.sendMessage and its callers never run a response validator, so a
 * missing branch there cannot reject anything.
 */
const REQUEST_CALLS = /(?:sendSpectraRequest|createSpectraRequest|sendSpectraTabRequest)\(\s*'(spectra\.[^']+)'/gu;
const COVERED_BRANCH = /type === '(spectra\.[^']+)'/gu;

function walk(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			for (const nested of walk(full)) found.push(nested);
			continue;
		}
		if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(full);
	}
	return found;
}

export function checkContentResponseCoverage(root: string): void {
	section('检查 Content 响应校验覆盖...');

	const slimPath = path.join(root, SLIM_ENTRY);
	if (!fs.existsSync(slimPath)) {
		error(`缺少 Content 轻量契约入口: ${SLIM_ENTRY}`);
		return;
	}
	const slim = fs.readFileSync(slimPath, 'utf8');
	const bodyStart = slim.indexOf('function isContentResponseData');
	if (bodyStart < 0) {
		error(`${SLIM_ENTRY} 中找不到 isContentResponseData`);
		return;
	}
	const covered = new Set<string>();
	for (const match of slim.slice(bodyStart).matchAll(COVERED_BRANCH)) covered.add(match[1] as string);

	const issued = new Map<string, string>();
	for (const file of walk(path.join(root, CONTENT_ROOT))) {
		const source = fs.readFileSync(file, 'utf8');
		for (const match of source.matchAll(REQUEST_CALLS)) {
			const type = match[1] as string;
			if (!issued.has(type)) issued.set(type, path.relative(root, file).split(path.sep).join('/'));
		}
	}

	let missing = 0;
	for (const [type, file] of issued) {
		if (covered.has(type)) continue;
		error(`${type} 由 ${file} 发出，但 ${SLIM_ENTRY} 没有对应响应分支（生产 Content 包会拒绝其合法响应）`);
		missing += 1;
	}

	for (const type of covered) {
		if (!issued.has(type)) {
			warn(`${type} 在轻量校验器中有响应分支，但 Content 已不再发出该请求`, true);
		}
	}

	if (missing === 0) ok(`Content 发出的 ${issued.size} 个请求类型均已有响应校验分支`);
}
