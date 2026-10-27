/**
 * 检查契约层的运行时键集合是否与类型绑死
 *
 * 根因：`ControlFieldState` 增加可选字段 `writeState` 后，运行时允许键集合
 * `fieldStateKeys` 没有同步，`hasOnlyKeys` 判假，整个 ACK 被判非法。
 * 表现为 Background 丢弃每次原生写入确认，用户看到「音量回弹」和
 * `invalid SPECTRA extension RPC v2 response`。类型检查看不见这类漂移，
 * 因为集合是手写的 `new Set<keyof T>(...)`，与类型没有任何机械绑定。
 *
 * 规则：
 * - 新增代码必须使用 `keySetOf<T>()`，它在编译期要求列全 T 的每个键；
 * - 存量手写集合按文件登记基线，只能减少，不能增加；
 * - 基线低于实际值时提示收紧，避免基线变成永久豁免。
 */

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const CONTRACTS_SOURCE = 'packages/contracts/src';
const BASELINE_FILE = 'contract-key-set-baseline.json';
const HAND_WRITTEN = /new Set<keyof\s/gu;

function countHandWrittenSets(content: string): number {
	return content.match(HAND_WRITTEN)?.length ?? 0;
}

function sourceFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...sourceFiles(full));
			continue;
		}
		if (entry.name.endsWith('.ts')) found.push(full);
	}
	return found;
}

export function checkContractKeySets(root: string): void {
	section('Contract key sets bound to their types');
	const baselinePath = path.join(root, BASELINE_FILE);
	if (!fs.existsSync(baselinePath)) {
		error(`${BASELINE_FILE} is missing; the ratchet has no baseline to compare against`);
		return;
	}

	const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
		readonly files?: Record<string, number>;
	};
	const expected = baseline.files ?? {};
	const actual = new Map<string, number>();

	for (const file of sourceFiles(path.join(root, CONTRACTS_SOURCE))) {
		const relative = path.relative(root, file).replaceAll('\\', '/');
		const count = countHandWrittenSets(fs.readFileSync(file, 'utf8'));
		if (count > 0) actual.set(relative, count);
	}

	for (const [file, count] of actual) {
		const allowed = expected[file];
		if (allowed === undefined) {
			error(
				`${file} adds ${count} hand-written key set(s); use keySetOf<T>() so the`
				+ ' allowlist cannot drift from the type',
			);
			continue;
		}
		if (count > allowed) {
			error(
				`${file} grew from ${allowed} to ${count} hand-written key set(s);`
				+ ' use keySetOf<T>() for new ones',
			);
		} else if (count < allowed) {
			warn(`${file} is down to ${count} hand-written key set(s); tighten ${BASELINE_FILE}`);
		}
	}

	for (const file of Object.keys(expected)) {
		if (!actual.has(file) && expected[file] !== 0) {
			warn(`${file} no longer has hand-written key sets; tighten ${BASELINE_FILE}`);
		}
	}

	if (countersClean(root, expected)) {
		ok('control wire surface has no hand-written key sets');
	}
}

function countersClean(root: string, expected: Record<string, number>): boolean {
	const controlFile = 'packages/contracts/src/control.contracts.ts';
	const full = path.join(root, controlFile);
	if (!fs.existsSync(full)) return false;
	if ((expected[controlFile] ?? 0) !== 0) return false;
	return countHandWrittenSets(fs.readFileSync(full, 'utf8')) === 0;
}
