// goal: Diff core logic - simple line-based diff algorithm (no external deps)

import type { DiffResult, DiffStats } from './types';

function requireItem<T>(items: readonly T[], index: number, label: string): T {
	const item = items[index];
	if (item === undefined) {
		throw new RangeError(`${label} index ${index} is out of bounds`);
	}
	return item;
}

function requireRow(matrix: number[][], index: number): number[] {
	return requireItem(matrix, index, 'LCS row');
}

function getCell(matrix: number[][], row: number, column: number): number {
	return requireItem(requireRow(matrix, row), column, 'LCS column');
}

// Simple line-based diff using LCS (Longest Common Subsequence)
export function diffLines(text1: string, text2: string): DiffResult[] {
	const lines1 = text1.split('\n');
	const lines2 = text2.split('\n');
	const result: DiffResult[] = [];

	// LCS matrix
	const m = lines1.length;
	const n = lines2.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

	// Build LCS table
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const row = requireRow(dp, i);
			if (
				requireItem(lines1, i - 1, 'left line')
				=== requireItem(lines2, j - 1, 'right line')
			) {
				row[j] = getCell(dp, i - 1, j - 1) + 1;
			} else {
				row[j] = Math.max(
					getCell(dp, i - 1, j),
					getCell(dp, i, j - 1),
				);
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
			&& requireItem(lines1, i - 1, 'left line')
				=== requireItem(lines2, j - 1, 'right line')
		) {
			stack.push({
				type: 'equal',
				value: requireItem(lines1, i - 1, 'left line'),
			});
			i--;
			j--;
		} else if (
			j > 0
			&& (i === 0 || getCell(dp, i, j - 1) >= getCell(dp, i - 1, j))
		) {
			stack.push({
				type: 'insert',
				value: requireItem(lines2, j - 1, 'right line'),
			});
			j--;
		} else {
			stack.push({
				type: 'delete',
				value: requireItem(lines1, i - 1, 'left line'),
			});
			i--;
		}
	}

	// Reverse to get correct order
	while (stack.length) {
		const item = stack.pop();
		if (item) result.push(item);
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
