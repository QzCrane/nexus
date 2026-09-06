// goal: distinguish executable toolchain pins from immutable historical evidence
// inv: only the exact source-disposition ledger and archived documents are historical
export function findBunVersionDrift(path: string, content: string, expected: string): string[] {
	const normalized = path.replaceAll('\\', '/');
	if (normalized.includes('/docs/_archive/') || normalized === 'nexus/integration-decisions.json') return [];
	const patterns = [
		/\bbun@(\d+\.\d+\.\d+)\b/giu,
		/\bBun\s+(\d+\.\d+\.\d+)\b/gu,
		/\bBUN_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/gu,
		/\bbun-version:\s*['"]?(\d+\.\d+\.\d+)\b/gu,
	];
	return patterns.flatMap((pattern) => [...content.matchAll(pattern)]
		.filter((match) => match[1] !== expected)
		.map((match) => `${normalized}: Bun ${match[1]}`));
}
