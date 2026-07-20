import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(workspaceDir, '..');
const expected = Object.freeze({ bun: '1.3.14', biome: '2.5.3', turbo: '2.10.5' });
const expectedPackageManager = `bun@${expected.bun}`;

const workspaceManifest = JSON.parse(readFileSync(resolve(workspaceDir, 'package.json'), 'utf8'));
const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));

if (Bun.version !== expected.bun) {
	throw new Error(`Bun ${expected.bun} is required, found ${Bun.version}`);
}

function commandVersion(command, args) {
	const result = spawnSync(command, args, {
		cwd: workspaceDir,
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} version check failed: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

const actual = {
	bun: Bun.version,
	biome: commandVersion(process.execPath, ['x', '--bun', 'biome', '--version']).match(/\d+\.\d+\.\d+/u)?.[0],
	turbo: commandVersion(process.execPath, ['x', '--bun', 'turbo', '--version']).match(/\d+\.\d+\.\d+/u)?.[0],
};

if (
	rootManifest.packageManager !== expectedPackageManager ||
	workspaceManifest.packageManager !== expectedPackageManager ||
	workspaceManifest.devDependencies?.['@biomejs/biome'] !== expected.biome ||
	workspaceManifest.devDependencies?.turbo !== expected.turbo
) {
	throw new Error('Toolchain manifest pins do not match the release contract');
}

for (const [tool, version] of Object.entries(expected)) {
	if (actual[tool] !== version) {
		throw new Error(`${tool} ${version} is required, found ${actual[tool] ?? 'unknown'}`);
	}
}

const ignoredDirectories = new Set([
	'.git',
	'.turbo',
	'build',
	'dist',
	'node_modules',
	'coverage',
]);
const scannedExtensions = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.toml', '.yaml', '.yml']);
const versionPatterns = [
	/\bbun@(\d+\.\d+\.\d+)\b/giu,
	/\bBun\s+(\d+\.\d+\.\d+)\b/gu,
	/\bBUN_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/gu,
];

function collectFiles(directory, output = []) {
	for (const entry of readdirSync(directory)) {
		if (ignoredDirectories.has(entry)) continue;
		const fullPath = join(directory, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			collectFiles(fullPath, output);
			continue;
		}
		if (!stats.isFile() || !scannedExtensions.has(extname(entry))) continue;
		if (entry === 'bun.lock' || entry === 'bun.lockb') continue;
		output.push(fullPath);
	}
	return output;
}

const drift = [];
for (const filePath of collectFiles(repositoryRoot)) {
	const content = readFileSync(filePath, 'utf8');
	for (const pattern of versionPatterns) {
		pattern.lastIndex = 0;
		for (const match of content.matchAll(pattern)) {
			if (match[1] !== expected.bun) {
				drift.push(`${relative(repositoryRoot, filePath)}: Bun ${match[1]}`);
			}
		}
	}
}

if (drift.length > 0) {
	throw new Error(`Bun version drift detected; expected ${expected.bun}:\n${drift.join('\n')}`);
}

console.log(`✓ Toolchain: Bun ${actual.bun}, Biome ${actual.biome}, Turbo ${actual.turbo}`);
console.log(`✓ Repository Bun references: ${expectedPackageManager}`);
