/**
 * HALO Build Script (esbuild)
 * goal: keep startup surfaces physically isolated and production output lean
 * output: compressed single-line logs per step
 */

import esbuild from 'esbuild';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;
const isAnalyze = process.argv.includes('--analyze');
const distDir = path.join(__dirname, 'dist');

// Helper: run the pinned Bun directly with an argument array. This avoids
// cmd.exe/PowerShell/sh parsing and keeps quoting identical on every host.
function run(label, args, opts = {}) {
	const { silent = false, ...processOptions } = opts;
	try {
		execFileSync(process.execPath, args, {
			stdio: 'pipe',
			cwd: __dirname,
			...processOptions,
		});
		return true;
	} catch (e) {
		if (silent) return false;
		console.error(`❌ ${label}: ${e.stderr?.toString().trim() || e.message}`);
		return false;
	}
}

// Common build policy. Production strips diagnostic chatter from extension
// runtimes while preserving warning/error paths that carry actionable failures.
const commonConfig = {
	bundle: true,
	treeShaking: true,
	minify: !isDev,
	legalComments: 'none',
	// Production packages must not expose source paths or ship multi-megabyte
	// source maps. Development and watch builds retain linked maps for debugging.
	sourcemap: isDev,
	define: { 'process.env.NODE_ENV': isDev ? '"development"' : '"production"' },
	pure: isDev ? [] : ['console.debug', 'console.info', 'console.log'],
	drop: isDev ? [] : ['debugger'],
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js'),
	},
};

// Pre-flight checks (skip in watch mode)
if (!isWatch) {
	const registryPath = path.resolve(__dirname, '../../scripts/generate-tool-registry.ts');
	const verifyPath = path.resolve(__dirname, '../../scripts/verify-architecture.ts');

	// rule: check return values — `silent: true` previously swallowed failures
	// (the helper returned false but the caller ignored it), so a broken registry
	// or failing architecture verify would not fail the build.
	if (existsSync(registryPath)) {
		if (!run('registry', ['../../scripts/generate-tool-registry.ts'], { silent: true })) {
			console.error('❌ registry generation failed');
			process.exit(1);
		}
	}
	if (existsSync(verifyPath)) {
		if (!run('verify', ['../../scripts/verify-architecture.ts'], { silent: true })) {
			console.error('❌ verify failed');
			process.exit(1);
		}
	}

	if (!run('tsc', ['tsc', '--noEmit', '--skipLibCheck'])) {
		process.exit(1);
	}
	console.log('✓ Pre-flight: tsc OK');
}

// Prepare dist
if (existsSync(distDir)) {
	rmSync(distDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
mkdirSync(distDir, { recursive: true });
cpSync(path.join(__dirname, 'public'), distDir, { recursive: true });

// Copy SaaT script files
const toolsDir = path.join(__dirname, 'src/tools');
const scriptsDir = path.join(__dirname, 'src/scripts');
const distToolsDir = path.join(distDir, 'tools');
const distScriptsDir = path.join(distDir, 'scripts');

mkdirSync(distToolsDir, { recursive: true });
mkdirSync(distScriptsDir, { recursive: true });

async function buildScriptFiles(sourceDir, destBaseDir) {
	if (!existsSync(sourceDir)) return 0;
	const dirs = readdirSync(sourceDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

	const promises = dirs.map(async (dir) => {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const scriptTs = path.join(sourceDir, dir.name, 'script.ts');
		const destDir = path.join(destBaseDir, dir.name);
		let built = false;

		if (existsSync(scriptJs) || existsSync(scriptTs)) {
			mkdirSync(destDir, { recursive: true });
			try {
				await esbuild.build({
					entryPoints: [existsSync(scriptTs) ? scriptTs : scriptJs],
					outfile: path.join(destDir, 'script.js'),
					bundle: true,
					minify: !isDev,
					sourcemap: isDev ? 'inline' : false,
					target: ['chrome100'],
					format: 'esm',
					legalComments: 'none',
					logLevel: 'silent',
				});
				built = true;
			} catch (e) {
				console.error(`❌ Failed to build script ${dir.name}:`, e.message);
			}
		}
		if (existsSync(scriptCss)) {
			mkdirSync(destDir, { recursive: true });
			copyFileSync(scriptCss, path.join(destDir, 'script.css'));
			built = true;
		}
		return built ? 1 : 0;
	});

	const results = await Promise.all(promises);
	return results.reduce((total, value) => total + value, 0);
}

const [toolScriptsCount, officialScriptsCount] = await Promise.all([
	buildScriptFiles(toolsDir, distToolsDir),
	buildScriptFiles(scriptsDir, distScriptsDir),
]);

const entries = [
	{ entry: 'src/entry/content.ts', out: 'content.js', kind: 'classic' },
	{ entry: 'src/entry/background.ts', out: 'background.js', kind: 'classic' },
	{ entry: 'src/entry/sidepanel.tsx', out: 'sidepanel.js', kind: 'sidepanel' },
	{ entry: 'src/entry/sidepanel-init.ts', out: 'sidepanel-init.js', kind: 'classic' },
];

function buildOptions({ entry, out, kind }, extra = {}) {
	if (kind === 'sidepanel') {
		return {
			...commonConfig,
			entryPoints: { sidepanel: entry },
			outdir: distDir,
			entryNames: '[name]',
			chunkNames: 'chunks/[name]-[hash]',
			format: 'esm',
			splitting: true,
			...extra,
		};
	}
	return {
		...commonConfig,
		entryPoints: [entry],
		outfile: path.join(distDir, out),
		...extra,
	};
}

function walkFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const candidate = path.join(directory, entry.name);
		return entry.isDirectory() ? walkFiles(candidate) : [candidate];
	});
}

function relativeDist(file) {
	return path.relative(distDir, file).replaceAll('\\', '/');
}

function assertProductionSidepanelSplitting() {
	if (isDev) return;
	const chunksDir = path.join(distDir, 'chunks');
	const chunks = walkFiles(chunksDir).filter((file) => file.endsWith('.js'));
	if (chunks.length === 0) {
		throw new Error(
			'HALO production sidepanel emitted no lazy chunks; React.lazy imports must remain physically split',
		);
	}
}

if (isWatch) {
	console.log('👀 Watch mode...');
	const contexts = await Promise.all(entries.map(async (entry) => {
		const ctx = await esbuild.context(buildOptions(entry, {
			logLevel: 'warning',
			plugins: [{
				name: 'rebuild-notify',
				setup(build) {
					build.onEnd((result) => {
						if (result.errors.length === 0) console.log(`✓ ${entry.out}`);
					});
				},
			}],
		}));
		await ctx.watch();
		return ctx;
	}));

	process.on('SIGINT', async () => {
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
		process.exit(0);
	});
} else {
	// Build independent runtime surfaces in parallel. The sidepanel is the only
	// ESM splitting domain: each React.lazy import becomes a physical chunk and
	// heavy tool dependencies are not parsed on first panel paint.
	const buildResults = await Promise.all(entries.map(async (entry) => {
		try {
			const result = await esbuild.build(buildOptions(entry, {
				write: true,
				metafile: isAnalyze,
			}));
			const kb = Math.ceil(statSync(path.join(distDir, entry.out)).size / 1024);
			return { entry, result, label: `${entry.out.replace('.js', '')}:${kb}KB` };
		} catch (e) {
			console.error(`❌ ${entry.out}: ${e.message}`);
			process.exit(1);
		}
	}));

	assertProductionSidepanelSplitting();

	if (isAnalyze) {
		const report = buildResults.map(({ entry, result }) => ({
			entry: entry.out,
			kind: entry.kind,
			outputs: Object.fromEntries(
				Object.entries(result.metafile?.outputs ?? {})
					.map(([output, detail]) => [
						relativeDist(path.resolve(__dirname, output)),
						{ bytes: detail.bytes, entryPoint: detail.entryPoint, imports: detail.imports },
					])
					.sort(([left], [right]) => left.localeCompare(right)),
			),
		}));
		writeFileSync(
			path.join(distDir, 'build-analysis.json'),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	}

	const chunkFiles = walkFiles(path.join(distDir, 'chunks')).filter((file) => file.endsWith('.js'));
	const chunkBytes = chunkFiles.reduce((total, file) => total + statSync(file).size, 0);
	const chunkInfo = chunkFiles.length > 0
		? ` | chunks:${chunkFiles.length}/${Math.ceil(chunkBytes / 1024)}KB`
		: '';
	const saatInfo = toolScriptsCount + officialScriptsCount > 0
		? ` | SaaT:${toolScriptsCount + officialScriptsCount}`
		: '';
	console.log(`✓ Build: ${buildResults.map(({ label }) => label).join(' | ')}${chunkInfo}${saatInfo}`);
	console.log('🎉 Done → dist/');
}
