// goal: Diff core logic - simple line-based diff algorithm (no external deps)

import type { DiffResult, DiffStats } from './types';

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
			if (lines1[i - 1]! === lines2[j - 1]!) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	// Backtrack to find diff
	let i = m, j = n;
	const stack: DiffResult[] = [];

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && lines1[i - 1]! === lines2[j - 1]!) {
			stack.push({ type: 'equal', value: lines1[i - 1]! });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
			stack.push({ type: 'insert', value: lines2[j - 1]! });
			j--;
		} else {
			stack.push({ type: 'delete', value: lines1[i - 1]! });
			i--;
		}
	}

	// Reverse to get correct order
	while (stack.length) {
		result.push(stack.pop()!);
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
		if (i < words1.length && j < words2.length && words1[i]! === words2[j]!) {
			result.push({ type: 'equal', value: words1[i]! });
			i++;
			j++;
		} else if (j < words2.length && (i >= words1.length || words2[j]! !== words1[i]!)) {
			// Try to find in remaining
			const foundIn1 = words1.slice(i).indexOf(words2[j]!);
			if (foundIn1 > 0 && foundIn1 < 3) {
				// Delete the ones before
				for (let k = 0; k < foundIn1; k++) {
					result.push({ type: 'delete', value: words1[i + k]! });
				}
				i += foundIn1;
			} else {
				result.push({ type: 'insert', value: words2[j]! });
				j++;
			}
		} else {
			result.push({ type: 'delete', value: words1[i]! });
			i++;
		}
	}

	return result;
}
