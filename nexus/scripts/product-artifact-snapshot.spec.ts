import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildProductArtifactSnapshot } from './product-artifact-snapshot';

describe('product artifact snapshot', () => {
	test('records sorted exact file bytes and hashes bound to the measured identity', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-artifact-snapshot-'));
		try {
			mkdirSync(resolve(directory, 'nested'));
			writeFileSync(resolve(directory, 'manifest.json'), '{}');
			writeFileSync(resolve(directory, 'nested/a.js'), 'alpha');
			const snapshot = buildProductArtifactSnapshot({
				product: 'halo',
				distDir: directory,
				head: 'a'.repeat(40),
				tree: 'b'.repeat(40),
			});
			expect(snapshot).toMatchObject({
				schemaVersion: 1,
				product: 'halo',
				head: 'a'.repeat(40),
				tree: 'b'.repeat(40),
				totalBytes: 7,
			});
			expect(snapshot.files.map(({ path }) => path)).toEqual(['manifest.json', 'nested/a.js']);
			expect(snapshot.files.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test('fails closed on a non-artifact directory or inexact identity', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-artifact-snapshot-'));
		try {
			expect(() => buildProductArtifactSnapshot({
				product: 'spectra', distDir: directory, head: 'a'.repeat(40), tree: 'b'.repeat(40),
			})).toThrow('missing manifest.json');
			writeFileSync(resolve(directory, 'manifest.json'), '{}');
			expect(() => buildProductArtifactSnapshot({
				product: 'spectra', distDir: directory, head: 'bad', tree: 'b'.repeat(40),
			})).toThrow('exact Git head/tree');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
