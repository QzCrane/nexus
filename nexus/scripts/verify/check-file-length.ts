/**
 * Report source-file review signals against the single-authority ledger.
 * Line count never substitutes for a real module boundary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ok, scanDir, log, section, warn } from './utils.ts';

const MAX_LINES = 1000;
const SKIP_DIRS = /[/\\](node_modules|dist|\.turbo|\.git|build|coverage)[/\\]/;

interface FileLengthException {
	maxLines: number;
	owner: string;
	rationale: string;
	decompositionTrigger: string;
}

interface FileLengthPolicy {
	schemaVersion: 1;
	defaultMaxLines: number;
	exceptions: Record<string, FileLengthException>;
}

function readPolicy(root: string): FileLengthPolicy {
	const policyPath = path.join(root, 'scripts/verify/file-length-policy.json');
	const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as FileLengthPolicy;
	if (policy.schemaVersion !== 1 || policy.defaultMaxLines !== MAX_LINES
		|| !policy.exceptions || typeof policy.exceptions !== 'object') {
		throw new Error('file-length-policy.json has an invalid schema or default limit');
	}
	for (const [file, exception] of Object.entries(policy.exceptions)) {
		if (!file.includes('/') || !Number.isInteger(exception.maxLines)
			|| exception.maxLines <= MAX_LINES
			|| !exception.owner.trim() || !exception.rationale.trim()
			|| !exception.decompositionTrigger.trim()) {
			throw new Error(`Invalid file-length exception: ${file}`);
		}
	}
	return policy;
}

export function checkSourceFileLength(root: string): void {
	section('检查源文件长度与单一权威策略...');
	const policy = readPolicy(root);
	const seenExceptions = new Set<string>();
	let registered = 0;
	let checked = 0;

	scanDir(root, (fullPath) => {
		if (SKIP_DIRS.test(fullPath)) return;
		if (!/[/\\]src[/\\].*\.tsx?$/.test(fullPath)) return;
		const content = fs.readFileSync(fullPath, 'utf8');
		if (content.startsWith('// AUTO-GENERATED - DO NOT EDIT')) return;
		checked += 1;
		const lines = content.split('\n').length;
		if (lines <= MAX_LINES) return;

		const relative = path.relative(root, fullPath).replace(/\\/g, '/');
		const exception = policy.exceptions[relative];
		if (!exception) {
			warn(`${relative}: ${lines} 行超过 review signal ${MAX_LINES}，请确认单一 owner 与真实拆分边界`);
			return;
		}
		seenExceptions.add(relative);
		registered += 1;
		if (lines > exception.maxLines) {
			warn(`${relative}: ${lines} 行超过登记 review signal ${exception.maxLines} (${exception.owner})`);
			return;
		}
		log(`  (owned) ${relative}: ${lines}/${exception.maxLines} (${exception.owner})`);
	});

	for (const file of Object.keys(policy.exceptions)) {
		if (!seenExceptions.has(file)) {
			warn(`${file}: 文件已不存在或不再超限，请删除过期结构登记`);
		}
	}
	if (registered === Object.keys(policy.exceptions).length) {
		ok(`源文件长度策略通过 (扫描 ${checked} 个文件，${registered} 个登记单一权威)`);
	}
}
