import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	configProblems,
	eolProblems,
	indexModeProblems,
	isFirstPartyProcessSource,
	packageScriptProblems,
	parseEolEntries,
	parseGitBatchObjects,
	parseIndexEntries,
	portablePathProblems,
	processSourceProblems,
	readPackageScripts,
	textEncodingProblems,
} from './platform-contract.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

function git(args) {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	});
}

function readIndexFiles(entries) {
	const objectIds = [...new Set(entries
		.filter((entry) => entry.mode !== '160000')
		.map((entry) => entry.objectId))];
	const output = execFileSync('git', ['cat-file', '--batch'], {
		cwd: repositoryRoot,
		input: `${objectIds.join('\n')}\n`,
		maxBuffer: 64 * 1024 * 1024,
	});
	const objects = parseGitBatchObjects(output);
	const files = new Map();
	for (const entry of entries) {
		if (entry.mode === '160000') continue;
		const object = objects.get(entry.objectId);
		if (object?.type !== 'blob') {
			throw new Error(`${entry.path}: indexed object ${entry.objectId} is not a readable blob`);
		}
		files.set(entry.path, object.bytes);
	}
	return files;
}

function checkPlatformContract() {
	const indexEntries = parseIndexEntries(git(['ls-files', '--stage', '-z']));
	const eolEntries = parseEolEntries(git(['ls-files', '--eol', '-z']));
	const paths = indexEntries.map((entry) => entry.path);
	const indexFiles = readIndexFiles(indexEntries);
	const readIndexedBytes = (path) => {
		const bytes = indexFiles.get(path);
		if (!bytes) throw new Error(`${path}: file is missing from the Git index`);
		return bytes;
	};
	const problems = [
		...configProblems(repositoryRoot),
		...portablePathProblems(paths),
		...indexModeProblems(indexEntries, readIndexedBytes),
		...eolProblems(eolEntries),
		...textEncodingProblems(
			eolEntries,
			readIndexedBytes,
		),
	];

	for (const manifest of readPackageScripts(
		paths,
		(path) => readIndexedBytes(path).toString('utf8'),
	)) {
		problems.push(...packageScriptProblems(manifest.path, manifest.scripts));
	}
	for (const path of paths.filter(isFirstPartyProcessSource)) {
		const source = readIndexedBytes(path).toString('utf8');
		problems.push(...processSourceProblems(path, source));
	}

	if (problems.length > 0) {
		throw new Error(`Cross-platform contract failed (${problems.length}):\n${problems.join('\n')}`);
	}

	const executableCount = indexEntries.filter((entry) => entry.mode === '100755').length;
	const binaryCount = eolEntries.filter((entry) => entry.attributes.includes('-text')).length;
	console.log(`✓ Platform paths: ${paths.length} tracked files, case-fold unique and Windows-legal`);
	console.log(`✓ Platform bytes: UTF-8/LF text contract, ${binaryCount} explicit binary/opaque files`);
	console.log(`✓ Platform processes: portable package scripts and argument-array child processes`);
	console.log(`✓ Platform execution: ${executableCount} shebang scripts, Windows + Ubuntu CI`);
}

try {
	checkPlatformContract();
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
