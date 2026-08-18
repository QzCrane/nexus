import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = resolve(projectDir, 'test');
const chromeIntegrationTests = new Set([
	'diagnostics-chrome.spec.ts',
	'performance.spec.ts',
	'runtime-stress-performance.spec.ts',
	'smoke.spec.ts',
	'tab-visibility-chrome.spec.ts',
]);

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

export function listDefaultTests() {
	return walk(testDir)
		.map((path) => relative(testDir, path).replaceAll('\\', '/'))
		.filter((path) => path.endsWith('.spec.ts') && !chromeIntegrationTests.has(path))
		.sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
}

export function runDefaultTests() {
	const tests = listDefaultTests();
	if (tests.length === 0) throw new Error('Default SPECTRA test matrix is empty');
	console.log(`Running ${tests.length} unit, contract, and runtime test files`);
	const result = spawnSync(process.execPath, ['test', ...tests.map((path) => `test/${path}`)], {
		cwd: projectDir,
		stdio: 'inherit',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Default SPECTRA tests failed with exit code ${result.status ?? 'unknown'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === '--list') console.log(listDefaultTests().join('\n'));
	else if (args.length === 0) runDefaultTests();
	else throw new Error(`Unknown run-tests option: ${args.join(', ')}`);
}
