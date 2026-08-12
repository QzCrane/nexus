import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneTurboCache } from './prune-turbo-cache.mjs';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-turbo-cache-'));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => (
		rm(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		})
	)));
});

describe('Turbo cache pruning', () => {
	test('keeps the newest entries while enforcing byte and file-count bounds', async () => {
		const directory = await temporaryDirectory();
		const oldest = join(directory, 'oldest.bin');
		const middle = join(directory, 'middle.bin');
		const newest = join(directory, 'newest.bin');
		await Promise.all([
			writeFile(oldest, 'aaaa'),
			writeFile(middle, 'bbbb'),
			writeFile(newest, 'cccc'),
		]);
		await utimes(oldest, new Date(1_000), new Date(1_000));
		await utimes(middle, new Date(2_000), new Date(2_000));
		await utimes(newest, new Date(3_000), new Date(3_000));

		const result = await pruneTurboCache(directory, { maxBytes: 8, maxFiles: 2 });
		expect(result).toEqual({ deletedFiles: 1, remainingFiles: 2, remainingBytes: 8 });
		await expect(readFile(oldest)).rejects.toThrow();
		expect(await readFile(middle, 'utf8')).toBe('bbbb');
		expect(await readFile(newest, 'utf8')).toBe('cccc');

		const countBound = await pruneTurboCache(directory, { maxBytes: 1_000, maxFiles: 1 });
		expect(countBound).toEqual({ deletedFiles: 1, remainingFiles: 1, remainingBytes: 4 });
		await expect(readFile(middle)).rejects.toThrow();
		expect(await readFile(newest, 'utf8')).toBe('cccc');
	});

	test('treats a missing cache directory as an already empty bounded store', async () => {
		const directory = join(await temporaryDirectory(), 'missing');
		expect(await pruneTurboCache(directory, { maxBytes: 1, maxFiles: 1 })).toEqual({
			deletedFiles: 0,
			remainingFiles: 0,
			remainingBytes: 0,
		});
	});
});
