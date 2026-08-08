#!/usr/bin/env node
// goal: Auto-generate HALO registry artifacts from manifest files
// eff: Unified UI registry plus minimal runtime projections

import { TOOLS_DIR, SCRIPTS_DIR, SYSTEM_DIR } from './registry-gen/config.ts';
import { discoverPlugins, parseManifest } from './registry-gen/discover.ts';
import {
	generateBackgroundActiveProjection,
	generateRegistry,
	generateScriptRuntimeManifest,
	generateStartupRegistry,
} from './registry-gen/gen-registry.ts';
import { generateLoader } from './registry-gen/gen-loader.ts';
import { generateI18n } from './registry-gen/gen-i18n.ts';

function main() {
	console.log('🔍 Scanning plugins...');

	const toolModules = discoverPlugins(TOOLS_DIR, 'tools');
	const scriptModules = discoverPlugins(SCRIPTS_DIR, 'scripts');
	const systemModules = discoverPlugins(SYSTEM_DIR, 'system');
	const allModules = [...toolModules, ...scriptModules, ...systemModules];

	if (allModules.length === 0) {
		console.log('ℹ️ No plugins found.');
		return;
	}

	const manifestsMap = new Map();
	allModules.forEach((module) => {
		const manifest = parseManifest(module.manifestPath);
		if (manifest) manifestsMap.set(module.id, manifest);
	});

	const validModules = allModules.filter((module) => manifestsMap.has(module.id));

	for (const module of validModules) {
		const manifest = manifestsMap.get(module.id);
		const declaredType = manifest.pluginType;

		if (module.dirType === 'tools' && declaredType && declaredType !== 'tool') {
			console.error(`❌ Policy: '${module.id}' in src/tools/ must have pluginType:'tool' or omit it`);
			process.exit(1);
		}
		if (module.dirType === 'scripts' && declaredType !== 'script') {
			console.error(`❌ Policy: '${module.id}' in src/scripts/ must have pluginType:'script'`);
			process.exit(1);
		}
		if (module.dirType === 'system' && declaredType !== 'system') {
			console.error(`❌ Policy: '${module.id}' in src/system/ must have pluginType:'system'`);
			process.exit(1);
		}
	}

	const toolCount = validModules.filter((module) => module.pluginType === 'tool').length;
	const scriptCount = validModules.filter((module) => module.pluginType === 'script').length;
	const systemCount = validModules.filter((module) => module.pluginType === 'system').length;

	console.log(`📦 Found: ${toolCount} Tools + ${scriptCount} Scripts + ${systemCount} System`);

	generateRegistry(validModules, manifestsMap);
	generateStartupRegistry(validModules, manifestsMap);
	generateBackgroundActiveProjection(validModules, manifestsMap);
	generateScriptRuntimeManifest(validModules, manifestsMap);
	generateLoader(validModules);
	generateI18n(validModules);

	console.log('\n✨ Registry generation complete!');
}

main();
