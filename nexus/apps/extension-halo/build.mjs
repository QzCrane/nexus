import esbuild from 'esbuild';
const { build } = esbuild;
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run generate-registry to ensure tool panels are up-to-date
try {
	console.log('📦 Generating tool registry...');
	execSync('node ../../scripts/generate-tool-registry.mjs', { stdio: 'inherit', cwd: __dirname });
} catch {
	console.error('⚠️ generate-registry failed, continuing build...');
}

// Run verify-architecture first
try {
	console.log('🔍 Running verify-architecture...');
	execSync('node ../../scripts/verify-architecture.js', { stdio: 'inherit', cwd: __dirname });
} catch {
	console.error('⚠️ verify-architecture failed, continuing build...');
}

// Clean dist
fs.removeSync('dist');
fs.ensureDirSync('dist');

// Copy public assets
fs.copySync('public', 'dist');
console.log('✓ Copied public files');

// Copy SaaT script files (script.js, script.css) for Script-as-a-Tool
// Scan both src/tools and src/scripts
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

if (toolScriptsCount + officialScriptsCount > 0) {
	console.log(`✓ Copied ${toolScriptsCount + officialScriptsCount} SaaT script files (Tools: ${toolScriptsCount}, Scripts: ${officialScriptsCount})`);
}

// Config
const isWatch = process.argv.includes('--watch');

const commonConfig = {
	bundle: true,
	minify: !isWatch,
	sourcemap: isWatch,
	define: {
		'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
	},
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/contracts': path.resolve(__dirname, '../../packages/contracts/dist/index.js'),
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js')
	}
};

// Build Content Script
build({
	...commonConfig,
	entryPoints: ['src/entry/content.ts'],
	outfile: 'dist/content.js',
}).then(() => console.log('✓ Built content.js')).catch(e => { console.error(e); process.exit(1); });

// Build Background
build({
	...commonConfig,
	entryPoints: ['src/entry/background.ts'],
	outfile: 'dist/background.js',
}).then(() => console.log('✓ Built background.js')).catch(e => { console.error(e); process.exit(1); });

// Build SidePanel (React)
build({
	...commonConfig,
	entryPoints: ['src/entry/sidepanel.tsx'],
	outfile: 'dist/sidepanel.js',
}).then(() => console.log('✓ Built sidepanel.js')).catch(e => { console.error(e); process.exit(1); });

// Build SidePanel Init (early theme + smooth scroll)
build({
	...commonConfig,
	entryPoints: ['src/entry/sidepanel-init.ts'],
	outfile: 'dist/sidepanel-init.js',
}).then(() => console.log('✓ Built sidepanel-init.js')).catch(e => { console.error(e); process.exit(1); });

console.log('\n🎉 HALO build complete!');
