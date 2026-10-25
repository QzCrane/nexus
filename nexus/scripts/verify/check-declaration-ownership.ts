// goal: one exported name owns one declaration site across the contract and app trees
//
// "Do not introduce mirrors, copied schemas, aliases" is a core invariant, but
// nothing enforced it for plain declarations. `applying` survived for months
// because a duplicated enum value has no runtime footprint; `rpcSuccess` drifted
// into three copies; the media fact shapes were declared twice with inlined
// literals instead of the existing aliases. None of those produce a failing test.
//
// A name that is exported from two files is not automatically wrong: two bundles
// that must not share a dependency (the complete protocol validator and the slim
// Content entry) legitimately restate the few guards each host can reach. What is
// wrong is doing so silently. This check therefore requires every duplicate to be
// recorded in the baseline with its owner and a reason, and reports a stale
// baseline entry so the list only shrinks.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const SCANNED_ROOTS = ['packages/contracts/src', 'apps/extension-spectra/src'] as const;
const BASELINE_PATH = path.join('scripts', 'verify', 'declaration-ownership-baseline.json');

/**
 * Only top-level `export` declarations count. A re-export (`export { x } from`)
 * is not a declaration and deliberately does not trip this check: it is how one
 * canonical symbol is offered through a second module entry.
 */
const DECLARATION = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|function|class|enum)\s+([A-Za-z_$][\w$]*)/gmu;

interface BaselineEntry {
	readonly owner: string;
	readonly reason: string;
}

interface Baseline {
	readonly duplicates: Record<string, BaselineEntry>;
}

function listSources(root: string, target: string): string[] {
	const absolute = path.join(root, target);
	if (!fs.existsSync(absolute)) return [];
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules' || entry.name === 'dist') continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
			found.push(full);
		}
	};
	walk(absolute);
	return found;
}

function normalize(file: string): string {
	return file.split(path.sep).join('/');
}

export function checkDeclarationOwnership(root: string): void {
	section('检查导出声明归属唯一性...');

	const baselineFile = path.join(root, BASELINE_PATH);
	if (!fs.existsSync(baselineFile)) {
		error(`缺少声明归属基线: ${normalize(BASELINE_PATH)}`);
		return;
	}
	const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Baseline;

	const sites = new Map<string, Set<string>>();
	for (const target of SCANNED_ROOTS) {
		for (const file of listSources(root, target)) {
			const source = fs.readFileSync(file, 'utf8');
			for (const match of source.matchAll(DECLARATION)) {
				const name = match[1] as string;
				const files = sites.get(name) ?? new Set<string>();
				files.add(normalize(path.relative(root, file)));
				sites.set(name, files);
			}
		}
	}

	const duplicates = [...sites.entries()].filter(([, files]) => files.size > 1);
	let unexplained = 0;
	for (const [name, files] of duplicates) {
		const entry = baseline.duplicates[name];
		if (!entry) {
			error(`${name} 在多个文件重复声明: ${[...files].join(', ')}（需收敛为单一 owner，或登记到基线并说明理由）`);
			unexplained += 1;
			continue;
		}
		if (!files.has(entry.owner)) {
			error(`${name} 的基线 owner ${entry.owner} 已不再声明该符号；重复位置为 ${[...files].join(', ')}`);
			unexplained += 1;
		}
	}

	for (const name of Object.keys(baseline.duplicates)) {
		if (!duplicates.some(([candidate]) => candidate === name)) {
			warn(`${name} 已不再重复声明，请从基线中删除该条目`, true);
		}
	}

	if (unexplained === 0) {
		ok(`导出声明归属唯一（${duplicates.length} 项已知并行声明均已登记）`);
	}
}
