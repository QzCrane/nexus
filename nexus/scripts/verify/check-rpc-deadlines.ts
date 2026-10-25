// goal: every cross-context send happens where a deadline can reach it
//
// F-5 in the audit was one parked sendMessage inside a per-tab serialized queue
// that froze every later operation for that tab. The fix bounded the three closures
// all traffic funnels through, but nothing stops the next direct call from being
// written outside them: chrome resolves a send with no listener to `undefined` and a
// listener that never replies parks the promise forever.
//
// A direct call is acceptable in exactly two shapes - wrapped in withDeadline, or
// fire-and-forget (void + .catch). Both are visible per call site, but "is this file
// allowed to call at all" is the decision worth recording, so the allowlist names
// each file and why. A new file calling sendMessage directly fails the check.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const SCANNED = 'apps/extension-spectra/src';
const ALLOWLIST = path.join('scripts', 'verify', 'rpc-deadline-allowlist.json');
const DIRECT_CALL = /chrome\.(?:runtime|tabs)\.sendMessage\s*\(/u;

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

export function checkRpcDeadlines(root: string): void {
	section('检查跨上下文调用的期限归属...');

	const allowlistFile = path.join(root, ALLOWLIST);
	if (!fs.existsSync(allowlistFile)) {
		error(`缺少 RPC 期限允许清单: ${path.relative(root, allowlistFile)}`);
		return;
	}
	const allowlist = (JSON.parse(fs.readFileSync(allowlistFile, 'utf8')) as {
		files: Record<string, string>;
	}).files;

	const callers = new Set<string>();
	for (const file of walk(path.join(root, SCANNED))) {
		if (!DIRECT_CALL.test(fs.readFileSync(file, 'utf8'))) continue;
		callers.add(path.relative(root, file).split(path.sep).join('/'));
	}

	let unknown = 0;
	for (const file of callers) {
		if (Object.hasOwn(allowlist, file)) continue;
		error(`${file} 直接调用 chrome.*.sendMessage 但未登记：改为经 shared/transport.ts 等收口点，或用 withDeadline 包裹后登记理由`);
		unknown += 1;
	}

	for (const file of Object.keys(allowlist)) {
		if (callers.has(file)) continue;
		if (file.endsWith('timeout.ts')) continue;
		warn(`${file} 已不再直接调用 sendMessage，请从允许清单移除`, true);
	}

	if (unknown === 0) ok(`${callers.size} 个直接调用点均已登记归属`);
}
