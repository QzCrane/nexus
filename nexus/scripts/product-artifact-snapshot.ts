// goal: record an exact, path-stable production dist snapshot for dependency-update comparisons

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProductArtifactFile {
	path: string;
	bytes: number;
	sha256: string;
}

export interface ProductArtifactSnapshot {
	schemaVersion: 1;
	product: 'halo' | 'spectra';
	head: string;
	tree: string;
	totalBytes: number;
	files: ProductArtifactFile[];
}

function assertIdentity(head: string, tree: string): void {
	if (!/^[a-f0-9]{40}$/u.test(head) || !/^[a-f0-9]{40}$/u.test(tree)) {
		throw new Error('product artifact snapshot requires exact Git head/tree');
	}
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(directory: string, root = directory): ProductArtifactFile[] {
	const files: ProductArtifactFile[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`production artifact snapshot rejects symbolic link: ${path}`);
		if (entry.isDirectory()) {
			files.push(...walk(path, root));
			continue;
		}
		if (!entry.isFile()) throw new Error(`production artifact snapshot rejects non-file entry: ${path}`);
		files.push({
			path: relative(root, path).replaceAll('\\', '/'),
			bytes: statSync(path).size,
			sha256: sha256File(path),
		});
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildProductArtifactSnapshot({
	product,
	distDir,
	head,
	tree,
}: {
	product: 'halo' | 'spectra';
	distDir: string;
	head: string;
	tree: string;
}): ProductArtifactSnapshot {
	assertIdentity(head, tree);
	const root = resolve(distDir);
	if (!existsSync(resolve(root, 'manifest.json'))) {
		throw new Error(`${product}: production dist is missing manifest.json: ${root}`);
	}
	const files = walk(root, root);
	if (files.length === 0) throw new Error(`${product}: production dist is empty`);
	return {
		schemaVersion: 1,
		product,
		head,
		tree,
		totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
		files,
	};
}

export function writeProductArtifactSnapshot(options: Parameters<typeof buildProductArtifactSnapshot>[0], outputPath: string): string {
	const snapshot = buildProductArtifactSnapshot(options);
	const path = resolve(outputPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
	return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [product, distDir, outputPath, head, tree] = process.argv.slice(2);
	if ((product !== 'halo' && product !== 'spectra') || !distDir || !outputPath || !head || !tree) {
		throw new Error('usage: bun scripts/product-artifact-snapshot.ts <halo|spectra> <dist-dir> <output-json> <head-sha> <tree-sha>');
	}
	const path = writeProductArtifactSnapshot({ product, distDir, head, tree }, outputPath);
	console.log(`✓ Product artifact snapshot: ${path}`);
}
