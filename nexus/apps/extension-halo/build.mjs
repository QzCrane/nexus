/**
 * HALO Build Script (esbuild)
 * goal: fast TypeScript build with pre-flight checks
 * output: compressed single-line logs per step
 */

import esbuild from 'esbuild';
import fs from 'fs-extra';
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

// Pre-flight checks (skip in watch mode)
if (!isWatch) {
	const registryPath = path.resolve(__dirname, '../../scripts/generate-tool-registry.mjs');
	const verifyPath = path.resolve(__dirname, '../../scripts/verify-architecture.js');
	
	if (fs.existsSync(registryPath)) {
		run('registry', 'node ../../scripts/generate-tool-registry.mjs', { silent: true });
	}
	if (fs.existsSync(verifyPath)) {
		run('verify', 'node ../../scripts/verify-architecture.js', { silent: true });
	}
	
	if (!run('tsc', 'npx tsc --noEmit --skipLibCheck')) {
		process.exit(1);
	}
	console.log('✓ Pre-flight: tsc OK');
}

// Prepare dist
fs.removeSync('dist');
fs.ensureDirSync('dist');
fs.copySync('public', 'dist');

// Copy SaaT script files
const toolsDir = path.join(__dirname, 'src/tools');
const scriptsDir = path.join(__dirname, 'src/scripts');
const distToolsDir = path.join(__dirname, 'dist/tools');
const distScriptsDir = path.join(__dirname, 'dist/scripts');

fs.ensureDirSync(distToolsDir);
fs.ensureDirSync(distScriptsDir);

function copyScriptFiles(sourceDir, destBaseDir) {
	if (!fs.existsSync(sourceDir)) return 0;
	const dirs = fs.readdirSync(sourceDir, { withFileTypes: true }).filter(d => d.isDirectory());
	let count = 0;
	for (const dir of dirs) {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const destDir = path.join(destBaseDir, dir.name);
		let copied = false;
		if (fs.existsSync(scriptJs)) {
			fs.ensureDirSync(destDir);
			fs.copyFileSync(scriptJs, path.join(destDir, 'script.js'));
			copied = true;
		}
		if (fs.existsSync(scriptCss)) {
			fs.ensureDirSync(destDir);
			fs.copyFileSync(scriptCss, path.join(destDir, 'script.css'));
			copied = true;
		}
		if (copied) count++;
	}
	return count;
}

const toolScriptsCount = copyScriptFiles(toolsDir, distToolsDir);
const officialScriptsCount = copyScriptFiles(scriptsDir, distScriptsDir);

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
			const kb = (fs.statSync(`dist/${out}`).size / 1024).toFixed(0);
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
