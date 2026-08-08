// goal: bound the local Turbo store before immutable GitHub cache snapshotting
// inv: keep newest cache files; never let one revision archive an unbounded cumulative store

import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_FILES = 12_000;

function parsePositiveInteger(value, name) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
	return parsed;
}

async function collectFiles(directory) {
	const files = [];
	const pending = [directory];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch (error) {
			if (error?.code === 'ENOENT') continue;
			throw error;
		}
		for (const entry of entries) {
			const path = resolve(current, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile()) {
				const metadata = await stat(path);
				files.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
			}
		}
	}
	return files;
}

export async function pruneTurboCache(
	directory,
	{ maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES } = {},
) {
	const files = await collectFiles(resolve(directory));
	let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
	let totalFiles = files.length;
	if (totalBytes <= maxBytes && totalFiles <= maxFiles) {
		return { deletedFiles: 0, remainingFiles: totalFiles, remainingBytes: totalBytes };
	}

	files.sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
	let deletedFiles = 0;
	for (const file of files) {
		if (totalBytes <= maxBytes && totalFiles <= maxFiles) break;
		try {
			await unlink(file.path);
			totalBytes -= file.size;
			totalFiles -= 1;
			deletedFiles += 1;
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
	}
	return { deletedFiles, remainingFiles: totalFiles, remainingBytes: totalBytes };
}

function argument(args, name) {
	const index = args.indexOf(name);
	return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const directory = process.argv[2];
	if (!directory) throw new Error('Usage: node prune-turbo-cache.mjs <directory> [--max-bytes N] [--max-files N]');
	const maxBytes = argument(process.argv, '--max-bytes');
	const maxFiles = argument(process.argv, '--max-files');
	const result = await pruneTurboCache(directory, {
		maxBytes: maxBytes === undefined ? DEFAULT_MAX_BYTES : parsePositiveInteger(maxBytes, '--max-bytes'),
		maxFiles: maxFiles === undefined ? DEFAULT_MAX_FILES : parsePositiveInteger(maxFiles, '--max-files'),
	});
	console.log(`[turbo-cache] deleted=${result.deletedFiles} files=${result.remainingFiles} bytes=${result.remainingBytes}`);
}
