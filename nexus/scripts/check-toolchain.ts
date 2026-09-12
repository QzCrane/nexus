import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBunVersionDrift, listCurrentToolchainFiles } from './toolchain-references';
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

const drift = [];
for (const filePath of listCurrentToolchainFiles(repositoryRoot)) {
	const content = readFileSync(filePath, 'utf8');
	drift.push(...findBunVersionDrift(relative(repositoryRoot, filePath), content, expected.bun));
}

if (drift.length > 0) {
	throw new Error(`Bun version drift detected; expected ${expected.bun}:\n${drift.join('\n')}`);
}

console.log(`✓ Toolchain: Bun ${actual.bun}, Biome ${actual.biome}, Turbo ${actual.turbo}`);
console.log(`✓ Repository Bun references: ${expectedPackageManager}`);
