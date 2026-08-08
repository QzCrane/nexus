// goal: measure a SidePanel-only Preact/compat candidate without changing canonical HALO build ownership
// inv: content scripts/background stay on the canonical build; this experiment overwrites only dist/sidepanel outputs.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

const PREACT_ALIAS = Object.freeze({
	'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
	'react/jsx-runtime': 'preact/jsx-runtime',
	'react-dom/client': 'preact/compat',
	'react-dom': 'preact/compat',
	react: 'preact/compat',
});

function outputAbsolute(output: string): string {
	return path.normalize(path.resolve(__dirname, output));
}

function kib(bytes: number): number {
	return Math.ceil(bytes / 1024);
}

function staticClosure(metafile: esbuild.Metafile, entryOutput: string) {
	const outputs = new Map(
		Object.entries(metafile.outputs).map(([output, detail]) => [outputAbsolute(output), detail]),
	);
	const start = path.normalize(path.join(distDir, entryOutput));
	if (!outputs.has(start)) throw new Error(`Preact experiment output is missing: ${entryOutput}`);

	const visited = new Set<string>();
	const stack = [start];
	let bytes = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current)) continue;
		const detail = outputs.get(current);
		if (!detail) continue;
		visited.add(current);
		bytes += detail.bytes;
		for (const imported of detail.imports ?? []) {
			if (imported.external || imported.kind === 'dynamic-import') continue;
			const target = path.normalize(path.resolve(path.dirname(current), imported.path));
			if (outputs.has(target) && !visited.has(target)) stack.push(target);
		}
	}
	return { bytes, outputs: visited };
}

function closureContributors(metafile: esbuild.Metafile, outputs: Set<string>, limit = 12) {
	const outputMap = new Map(
		Object.entries(metafile.outputs).map(([output, detail]) => [outputAbsolute(output), detail]),
	);
	const totals = new Map<string, number>();
	for (const output of outputs) {
		const detail = outputMap.get(output);
		if (!detail) continue;
		for (const [input, stats] of Object.entries(detail.inputs ?? {})) {
			const bytes = stats.bytesInOutput ?? 0;
			if (bytes <= 0) continue;
			const normalized = path.relative(__dirname, path.resolve(__dirname, input)).replaceAll('\\', '/');
			totals.set(normalized, (totals.get(normalized) ?? 0) + bytes);
		}
	}
	return [...totals.entries()]
		.map(([input, bytes]) => ({ input, bytes }))
		.sort((left, right) => right.bytes - left.bytes || left.input.localeCompare(right.input))
		.slice(0, limit);
}

const result = await esbuild.build({
	absWorkingDir: __dirname,
	entryPoints: { sidepanel: 'src/entry/sidepanel.tsx' },
	outdir: distDir,
	entryNames: '[name]',
	chunkNames: 'chunks/[name]-[hash]',
	bundle: true,
	splitting: true,
	format: 'esm',
	treeShaking: true,
	minify: true,
	legalComments: 'none',
	sourcemap: false,
	metafile: true,
	define: { 'process.env.NODE_ENV': '"production"' },
	pure: ['console.debug', 'console.info', 'console.log'],
	drop: ['debugger'],
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js'),
		...PREACT_ALIAS,
	},
});

const normalizedInputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll('\\', '/'));
const survivingReactRuntime = normalizedInputs.filter((input) => (
	/(^|\/)node_modules\/(react|react-dom|scheduler)(\/|@)/u.test(input)
	|| /react-dom\.production\.min\.js$/u.test(input)
));
if (survivingReactRuntime.length > 0) {
	throw new Error(`Preact experiment retained React runtime inputs: ${survivingReactRuntime.join(', ')}`);
}
if (!normalizedInputs.some((input) => /(^|\/)node_modules\/preact(\/|@)/u.test(input))) {
	throw new Error('Preact experiment emitted no Preact runtime input');
}

const startup = staticClosure(result.metafile, 'sidepanel.js');
const contributors = closureContributors(result.metafile, startup.outputs);
console.log(`✓ EXPERIMENT Preact SidePanel startup: ${kib(startup.bytes)}KiB/${startup.outputs.size} files (${startup.bytes} bytes)`);
console.log(`✓ EXPERIMENT Preact contributors: ${contributors.map(({ input, bytes }) => `${input}:${(bytes / 1024).toFixed(1)}KiB`).join(' | ')}`);
