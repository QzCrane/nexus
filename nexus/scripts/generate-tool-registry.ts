#!/usr/bin/env node
// goal: Auto-generate tool registry from manifest files
// eff: Unified schema with pluginType + functional category

import { TOOLS_DIR, SCRIPTS_DIR, SYSTEM_DIR } from './registry-gen/config.ts';
import { discoverPlugins, parseManifest } from './registry-gen/discover.ts';
import { generateRegistry } from './registry-gen/gen-registry.ts';
import { generateLoader } from './registry-gen/gen-loader.ts';
import { generateI18n } from './registry-gen/gen-i18n.ts';

function main() {
	console.log('🔍 Scanning plugins...');
	
	// Discover from all three directories
	const toolModules = discoverPlugins(TOOLS_DIR, 'tools');
	const scriptModules = discoverPlugins(SCRIPTS_DIR, 'scripts');
	const systemModules = discoverPlugins(SYSTEM_DIR, 'system');
	const allModules = [...toolModules, ...scriptModules, ...systemModules];
	
	if (allModules.length === 0) {
		console.log('ℹ️ No plugins found.');
		return;
	}

	// Parse manifests
	const manifestsMap = new Map();
	allModules.forEach(m => {
		const manifest = parseManifest(m.manifestPath);
		if (manifest) manifestsMap.set(m.id, manifest);
	});
	
	// Filter valid modules
	const validModules = allModules.filter(m => manifestsMap.has(m.id));
	
	// Validate plugin type rules
	for (const m of validModules) {
		const manifest = manifestsMap.get(m.id);
		const declaredType = manifest.pluginType;
		
		// Validate alignment: directory vs declared pluginType
		if (m.dirType === 'tools' && declaredType && declaredType !== 'tool') {
			console.error(`❌ Policy: '${m.id}' in src/tools/ must have pluginType:'tool' or omit it`);
			process.exit(1);
		}
		if (m.dirType === 'scripts' && declaredType !== 'script') {
			console.error(`❌ Policy: '${m.id}' in src/scripts/ must have pluginType:'script'`);
			process.exit(1);
		}
		if (m.dirType === 'system' && declaredType !== 'system') {
			console.error(`❌ Policy: '${m.id}' in src/system/ must have pluginType:'system'`);
			process.exit(1);
		}
	}

	const toolCount = validModules.filter(m => m.pluginType === 'tool').length;
	const scriptCount = validModules.filter(m => m.pluginType === 'script').length;
	const systemCount = validModules.filter(m => m.pluginType === 'system').length;
	
	console.log(`📦 Found: ${toolCount} Tools + ${scriptCount} Scripts + ${systemCount} System`);

	// Generate outputs
	generateRegistry(validModules, manifestsMap);
	generateLoader(validModules);
	generateI18n(validModules);

	console.log('\n✨ Registry generation complete!');
}

main();
