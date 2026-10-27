import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';

// goal: distinguish executable toolchain pins from immutable historical evidence
// inv: only source-disposition records, archived documents, research evidence and decision records are historical
export function findBunVersionDrift(path: string, content: string, expected: string): string[] {
	const normalized = path.replaceAll('\\', '/');
	// Research and decision records state the toolchain they measured or adopted at
	// the time. Rewriting those literals to today's pin would falsify the evidence;
	// treating them as live pins would make every future upgrade fail.
	if (normalized.includes('/docs/_archive/')
		|| normalized.includes('/docs/research/')
		|| normalized.includes('/docs/decisions/')
		|| normalized === 'nexus/integration-decisions.json') return [];
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
		&& !normalized.split('/').some((segment) => generatedDirectories.has(segment))
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

export function listCurrentToolchainFiles(repositoryRoot: string): string[] {
	if (!existsSync(resolve(repositoryRoot, '.git'))) return listArchiveToolchainFiles(repositoryRoot);
	// The gate validates the working tree before staging: Git owns ignore rules
	// and deletions, while newly authored source must already participate.
	const result = spawnSync('git', [
		'-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z',
	], { encoding: 'utf8', shell: false });
	const removed = spawnSync('git', ['-C', repositoryRoot, 'ls-files', '--deleted', '-z'], {
		encoding: 'utf8', shell: false,
	});
	for (const inventory of [result, removed]) {
		if (inventory.error) throw inventory.error;
		if (inventory.status !== 0) throw new Error(`git ls-files failed: ${inventory.stderr.trim()}`);
	}
	const deleted = new Set(removed.stdout.split('\0').filter(Boolean));
	return result.stdout.split('\0').filter((path) => path && !deleted.has(path)).filter(isCurrentToolchainFile)
		.map((path) => {
			const absolute = resolve(repositoryRoot, path);
			if (!existsSync(absolute)) throw new Error(`Tracked current source is missing: ${path}`);
			if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Current source is a symbolic link: ${path}`);
			return absolute;
		}).sort();
}
