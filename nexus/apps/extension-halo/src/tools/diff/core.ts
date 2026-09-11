// goal: Diff core logic - line-based diff algorithm (no external deps)
// rule: memory stays bounded. Common prefixes/suffixes are stripped first and
// the LCS table is a flat Int32Array capped at MAX_LCS_CELLS cells; beyond the
// cap the middle region degrades to an explicit block replace, which is still
// a correct edit script instead of an unbounded allocation.

import type { DiffResult, DiffStats } from './types';

function requireItem<T>(items: readonly T[], index: number, label: string): T {
	const item = items[index];
	if (item === undefined) {
		throw new RangeError(`${label} index ${index} is out of bounds`);
	}
	return item;
}

/** ~64 MiB of Int32 table; far past every plausible interactive diff. */
const MAX_LCS_CELLS = 16_000_000;

function cellAt(matrix: Int32Array, row: number, columns: number, column: number): number {
	return matrix[row * columns + column] ?? 0;
}

function setCell(matrix: Int32Array, row: number, columns: number, column: number, value: number): void {
	matrix[row * columns + column] = value;
}

function blockReplace(a: string[], b: string[]): DiffResult[] {
	return [
		...a.map((value) => ({ type: 'delete' as const, value })),
		...b.map((value) => ({ type: 'insert' as const, value })),
	];
}

function lcsDiff(a: string[], b: string[]): DiffResult[] {
	const m = a.length;
	const n = b.length;
	const columns = n + 1;
	const dp = new Int32Array((m + 1) * columns);

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (
				requireItem(a, i - 1, 'left line')
				=== requireItem(b, j - 1, 'right line')
			) {
				setCell(dp, i, columns, j, cellAt(dp, i - 1, columns, j - 1) + 1);
			} else {
				setCell(dp, i, columns, j, Math.max(
					cellAt(dp, i - 1, columns, j),
					cellAt(dp, i, columns, j - 1),
				));
			}
		}
	}

	// Backtrack to find diff
	let i = m, j = n;
	const stack: DiffResult[] = [];

	while (i > 0 || j > 0) {
		if (
			i > 0
			&& j > 0
			&& requireItem(a, i - 1, 'left line')
				=== requireItem(b, j - 1, 'right line')
		) {
			stack.push({ type: 'equal', value: requireItem(a, i - 1, 'left line') });
			i--;
			j--;
		} else if (
			j > 0
			&& (i === 0 || cellAt(dp, i, columns, j - 1) >= cellAt(dp, i - 1, columns, j))
		) {
			stack.push({ type: 'insert', value: requireItem(b, j - 1, 'right line') });
			j--;
		} else {
			stack.push({ type: 'delete', value: requireItem(a, i - 1, 'left line') });
			i--;
		}
	}

	const result: DiffResult[] = [];
	while (stack.length) {
		const item = stack.pop();
		if (item) result.push(item);
	}
	return result;
}

// Simple line-based diff using LCS (Longest Common Subsequence)
export function diffLines(text1: string, text2: string): DiffResult[] {
	const lines1 = text1.split('\n');
	const lines2 = text2.split('\n');

	// Strip the common prefix and suffix; real edits rarely touch whole files.
	let prefix = 0;
	while (prefix < lines1.length && prefix < lines2.length && lines1[prefix] === lines2[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < lines1.length - prefix
		&& suffix < lines2.length - prefix
		&& lines1[lines1.length - 1 - suffix] === lines2[lines2.length - 1 - suffix]
	) suffix++;

	const mid1 = lines1.slice(prefix, lines1.length - suffix);
	const mid2 = lines2.slice(prefix, lines2.length - suffix);

	const result: DiffResult[] = [];
	for (let index = 0; index < prefix; index++) {
		result.push({ type: 'equal', value: requireItem(lines1, index, 'left line') });
	}
	if ((mid1.length + 1) * (mid2.length + 1) > MAX_LCS_CELLS) {
		result.push(...blockReplace(mid1, mid2));
	} else {
		result.push(...lcsDiff(mid1, mid2));
	}
	for (let index = 0; index < suffix; index++) {
		result.push({ type: 'equal', value: requireItem(lines1, lines1.length - suffix + index, 'left line') });
	}
	return result;
}

// Calculate diff statistics
export function getDiffStats(diffs: DiffResult[]): DiffStats {
	let additions = 0;
	let deletions = 0;
	let changes = 0;

	for (const diff of diffs) {
		if (diff.type === 'insert') additions++;
		else if (diff.type === 'delete') deletions++;
	}

	changes = Math.min(additions, deletions);
	return { additions, deletions, changes };
}

// Simple word-level diff for inline highlighting
export function diffWords(text1: string, text2: string): DiffResult[] {
	const words1 = text1.split(/(\s+)/);
	const words2 = text2.split(/(\s+)/);
	const result: DiffResult[] = [];

	let i = 0, j = 0;
	while (i < words1.length || j < words2.length) {
		if (
			i < words1.length
			&& j < words2.length
			&& requireItem(words1, i, 'left word')
				=== requireItem(words2, j, 'right word')
		) {
			result.push({
				type: 'equal',
				value: requireItem(words1, i, 'left word'),
			});
			i++;
			j++;
		} else if (
			j < words2.length
			&& (
				i >= words1.length
				|| requireItem(words2, j, 'right word')
					!== requireItem(words1, i, 'left word')
			)
		) {
			// Try to find in remaining
			const rightWord = requireItem(words2, j, 'right word');
			const foundIn1 = words1.slice(i).indexOf(rightWord);
			if (foundIn1 > 0 && foundIn1 < 3) {
				// Delete the ones before
				for (let k = 0; k < foundIn1; k++) {
					result.push({
						type: 'delete',
						value: requireItem(words1, i + k, 'left word'),
					});
				}
				i += foundIn1;
			} else {
				result.push({ type: 'insert', value: rightWord });
				j++;
			}
		} else {
			result.push({
				type: 'delete',
				value: requireItem(words1, i, 'left word'),
			});
			i++;
		}
	}

	return result;
}
