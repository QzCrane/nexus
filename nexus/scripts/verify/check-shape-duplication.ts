// goal: one meaning, one declaration (INV-14 / G2)
//
// The declaration-ownership gate only sees names. Two interfaces with different
// names and identical fields are invisible to it, which is how the same error
// shape came to exist three times (AudioSessionError, ControlError, RpcError)
// without anything noticing.
//
// This gate does not demand that every duplicate be merged. Shape is not
// meaning: `RpcError.code` and `AudioSessionError.code` are different unions
// that happen to be spelled the same way, and collapsing them would be wrong.
// What is wrong is carrying the duplication silently. Every group must be
// recorded here with an owner and a reason, so the decision is reviewable and
// the list can only shrink.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const SCANNED_ROOTS = [
	'packages/contracts/src',
	'apps/extension-spectra/src',
] as const;

const BASELINE_PATH = path.join('scripts', 'verify', 'shape-duplication-baseline.json');

const EXPORTED_INTERFACE = /^export\s+interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?\{([\s\S]*?)^\}/gmu;

interface BaselineEntry {
	readonly owner: string;
	readonly reason: string;
}

interface Baseline {
	readonly duplicateShapes: Record<string, BaselineEntry>;
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

/**
 * Fields of an interface, comment-free and order-independent. Two declarations
 * that differ only in field order or doc comments describe the same data.
 */
function shapeOf(body: string): string | null {
	const fields = body
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0
			&& !line.startsWith('//')
			&& !line.startsWith('*')
			&& !line.startsWith('/*')
			&& !line.startsWith('[')
			&& !line.startsWith('readonly ['))
		.map((line) => line.replace(/;$/u, ''));
	if (fields.length === 0) return null;
	return [...fields].sort().join(' | ');
}

function readBaseline(): Baseline {
	if (!fs.existsSync(BASELINE_PATH)) return { duplicateShapes: {} };
	const parsed: unknown = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
	return { duplicateShapes: (parsed as Baseline).duplicateShapes ?? {} };
}

export function checkShapeDuplication(ROOT: string): void {
	section('检查结构重复声明（G2 / INV-14）...');

	const baseline = readBaseline();
	const groups = new Map<string, Set<string>>();

	for (const relative of SCANNED_ROOTS) {
		for (const file of listSources(ROOT, relative)) {
			const text = fs.readFileSync(file, 'utf8');
			for (const match of text.matchAll(EXPORTED_INTERFACE)) {
				const shape = shapeOf(match[2]);
				if (shape === null) continue;
				const names = groups.get(shape) ?? new Set<string>();
				names.add(match[1]);
				groups.set(shape, names);
			}
		}
	}

	const duplicates = [...groups.entries()]
		.filter(([, names]) => names.size > 1)
		.map(([shape, names]) => ({ key: [...names].sort().join('|'), shape }));

	for (const { key, shape } of duplicates) {
		const entry = baseline.duplicateShapes[key];
		if (!entry) {
			error(`SHAPE-001: identical shape declared more than once (${key}); shape: ${shape}`);
			continue;
		}
		if (!entry.owner.trim() || !entry.reason.trim()) {
			error(`SHAPE-001: ${key} is recorded without an owner and reason`);
		}
	}

	const live = new Set(duplicates.map(({ key }) => key));
	for (const key of Object.keys(baseline.duplicateShapes)) {
		if (live.has(key)) continue;
		warn(`SHAPE-002: baseline names ${key}, which is no longer duplicated`, true);
	}

	ok(`shape duplication checked across ${groups.size} declared shapes`);
}
