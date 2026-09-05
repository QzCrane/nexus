import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOME_VERSION, BUN_VERSION, TURBO_VERSION } from './toolchain-versions.ts';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(workspaceDir, '..');
const expected = Object.freeze({ bun: BUN_VERSION, biome: BIOME_VERSION, turbo: TURBO_VERSION });
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

const scannedExtensions = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.toml', '.yaml', '.yml']);
const versionPatterns = [
	/\bbun@(\d+\.\d+\.\d+)\b/giu,
	/\bBun\s+(\d+\.\d+\.\d+)\b/gu,
	/\bBUN_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/gu,
];

function trackedCurrentFiles() {
	const result = spawnSync('git', ['-C', repositoryRoot, 'ls-files', '-z'], {
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
	return result.stdout
		.split('\0')
		.filter(Boolean)
		.filter((path) => !path.includes('/docs/_archive/'))
		.filter((path) => path !== 'bun.lock' && scannedExtensions.has(extname(path)))
		.map((path) => resolve(repositoryRoot, path))
		.filter(existsSync);
}

const drift = [];
for (const filePath of trackedCurrentFiles()) {
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
