/**
 * HALO Build Script (esbuild)
 * goal: fast TypeScript build with pre-flight checks
 * output: compressed single-line logs per step
 */

import esbuild from 'esbuild';
import { rmSync, mkdirSync, cpSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;

// Helper: run command with compressed output
function run(label, cmd, opts = {}) {
	try {
		execSync(cmd, { stdio: 'pipe', cwd: __dirname, ...opts });
		return true;
	} catch (e) {
		if (opts.silent) return false;
		console.error(`❌ ${label}: ${e.stderr?.toString().trim() || e.message}`);
		return false;
	}
}

// Common Build Config
const commonConfig = {
	bundle: true,
	minify: !isDev,
	sourcemap: isDev,
	define: { 'process.env.NODE_ENV': isDev ? '"development"' : '"production"' },
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/contracts': path.resolve(__dirname, '../../packages/contracts/dist/index.js'),
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js')
	}
};

// Pre-flight checks (skip in watch mode)
if (!isWatch) {
	const registryPath = path.resolve(__dirname, '../../scripts/generate-tool-registry.mjs');
	const verifyPath = path.resolve(__dirname, '../../scripts/verify-architecture.js');

	if (existsSync(registryPath)) {
		run('registry', 'bun ../../scripts/generate-tool-registry.mjs', { silent: true });
	}
	if (existsSync(verifyPath)) {
		run('verify', 'bun ../../scripts/verify-architecture.js', { silent: true });
	}

	if (!run('tsc', 'bun tsc --noEmit --skipLibCheck')) {
		process.exit(1);
	}
	console.log('✓ Pre-flight: tsc OK');
}

// Prepare dist
if (existsSync('dist')) rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });

// Copy SaaT script files
const toolsDir = path.join(__dirname, 'src/tools');
const scriptsDir = path.join(__dirname, 'src/scripts');
const distToolsDir = path.join(__dirname, 'dist/tools');
const distScriptsDir = path.join(__dirname, 'dist/scripts');

mkdirSync(distToolsDir, { recursive: true });
mkdirSync(distScriptsDir, { recursive: true });


async function buildScriptFiles(sourceDir, destBaseDir) {
	if (!existsSync(sourceDir)) return 0;
	const dirs = readdirSync(sourceDir, { withFileTypes: true }).filter(d => d.isDirectory());

	const promises = dirs.map(async (dir) => {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const destDir = path.join(destBaseDir, dir.name);
		let built = false;

		const scriptTs = path.join(sourceDir, dir.name, 'script.ts');
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
	return results.reduce((a, b) => a + b, 0);
}

// Helper to build timeline assets (compile TS -> JS, copy CSS)
async function buildTimelineAssets() {
	const src = path.join(__dirname, 'src/tools/llm-enhancer/timeline');
	const dst = path.join(__dirname, 'dist/tools/llm-enhancer/timeline');
	if (!existsSync(src)) return;
	mkdirSync(dst, { recursive: true });

	// Copy CSS
	const files = readdirSync(src);
	for (const f of files) {
		if (f.endsWith('.css')) {
			copyFileSync(path.join(src, f), path.join(dst, f));
		}
	}

	// Build TS
	try {
		await esbuild.build({
			...commonConfig,
			entryPoints: [
				path.join(src, 'content-chatgpt.ts'),
				path.join(src, 'content-deepseek.ts'),
				path.join(src, 'content-gemini.ts')
			],
			outdir: dst,
			format: 'esm', // Must be ESM for dynamic import
			target: ['chrome100'],
			logLevel: 'warning'
		});
		console.log('✓ Built timeline assets');
	} catch (e) {
		console.error('❌ Failed to build timeline assets:', e.message);
	}
}

const [toolScriptsCount, officialScriptsCount] = await Promise.all([
	buildScriptFiles(toolsDir, distToolsDir),
	buildScriptFiles(scriptsDir, distScriptsDir)
]);
await buildTimelineAssets();



const entries = [
	{ entry: 'src/entry/content.ts', out: 'content.js' },
	{ entry: 'src/entry/background.ts', out: 'background.js' },
	{ entry: 'src/entry/sidepanel.tsx', out: 'sidepanel.js' },
	{ entry: 'src/entry/sidepanel-init.ts', out: 'sidepanel-init.js' }
];

if (isWatch) {
	console.log('👀 Watch mode...');
	const contexts = await Promise.all(entries.map(async ({ entry, out }) => {
		const ctx = await esbuild.context({
			...commonConfig,
			entryPoints: [entry],
			outfile: `dist/${out}`,
			logLevel: 'warning',
			plugins: [{
				name: 'rebuild-notify',
				setup(build) {
					build.onEnd(r => r.errors.length === 0 && console.log(`✓ ${out}`));
				}
			}]
		});
		await ctx.watch();
		return ctx;
	}));

	process.on('SIGINT', async () => {
		await Promise.all(contexts.map(ctx => ctx.dispose()));
		process.exit(0);
	});

} else {
	// Build all entries in parallel, collect results
	const results = await Promise.all(entries.map(async ({ entry, out }) => {
		try {
			await esbuild.build({ ...commonConfig, entryPoints: [entry], outfile: `dist/${out}`, write: true });
			const kb = (statSync(`dist/${out}`).size / 1024).toFixed(0);
			return `${out.replace('.js', '')}:${kb}KB`;
		} catch (e) {
			console.error(`❌ ${out}: ${e.message}`);
			process.exit(1);
		}
	}));

	// Single line output: all bundles with sizes + SaaT count
	const saatInfo = toolScriptsCount + officialScriptsCount > 0
		? ` | SaaT:${toolScriptsCount + officialScriptsCount}`
		: '';
	console.log(`✓ Build: ${results.join(' | ')}${saatInfo}`);
	console.log(`🎉 Done → dist/`);
}
