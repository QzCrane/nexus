import { readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

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

const scannedExtensions = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.toml', '.yaml', '.yml']);
const generatedDirectories = new Set([
	'.git', 'node_modules', '.turbo', 'dist', 'release', 'artifacts',
	'coverage', 'test-results', 'playwright-report',
]);

export function isCurrentToolchainFile(path: string): boolean {
	const normalized = path.replaceAll('\\', '/');
	return normalized !== 'bun.lock'
		&& !normalized.includes('/docs/_archive/')
		&& scannedExtensions.has(extname(normalized));
}

// git archive intentionally contains no Git metadata. Inspect every owned file
// in that immutable snapshot, including dot-directories, without installing a
// different tool into the digest-pinned runtime or trusting a partial manifest.
export function listArchiveToolchainFiles(repositoryRoot: string): string[] {
	const root = resolve(repositoryRoot);
	const paths: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (generatedDirectories.has(entry.name) && entry.isDirectory()) continue;
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) {
				throw new Error(`Source archive contains a symbolic link: ${relative(root, path)}`);
			}
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && isCurrentToolchainFile(relative(root, path))) paths.push(path);
		}
	};
	visit(root);
	return paths.sort();
}
