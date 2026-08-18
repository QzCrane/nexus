#!/usr/bin/env node
// goal: Auto-generate HALO catalog and release-admitted runtime artifacts from manifest files
// eff: Canonical UI registry plus minimal executable release projections

import {
	TOOLS_DIR,
	SCRIPTS_DIR,
	SYSTEM_DIR,
} from './registry-gen/config.ts';
import { discoverPlugins, parseManifest } from './registry-gen/discover.ts';
import {
	generateBackgroundActiveProjection,
	generateRegistry,
	generateScriptRuntimeManifest,
} from './registry-gen/gen-registry.ts';
import { generateLoader } from './registry-gen/gen-loader.ts';
import { generateI18n } from './registry-gen/gen-i18n.ts';
import { generateReleaseManifest } from './registry-gen/gen-release-manifest.ts';
import {
	generateReleaseAdmissionProjection,
	readReleaseAdmission,
	releaseAdmissionMap,
	validateReleaseAdmissionAgainstModules,
} from './registry-gen/release-admission.ts';

function main() {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== '--check' && arg !== '--write')
		|| args.includes('--check') && args.includes('--write')) {
		throw new Error('usage: generate-tool-registry.ts [--check|--write]');
	}
	const mode = args.includes('--check') ? 'check' : 'write';
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
		if ('size' in manifest) {
			throw new Error(
				`${module.id}: source-directory size is not release artifact evidence; remove manifest.size`,
			);
		}
		if (manifest.background) {
			if ('sourceLine' in manifest.background) {
				throw new Error(`${module.id}: background.sourceLine is unstable; use sourceAnchor`);
			}
			if (typeof manifest.background.sourceAnchor !== 'string'
				|| manifest.background.sourceAnchor.trim().length === 0) {
				throw new Error(`${module.id}: background.sourceAnchor must identify the live mechanism owner`);
			}
		}

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

	const admission = readReleaseAdmission();
	validateReleaseAdmissionAgainstModules(admission, validModules, manifestsMap);
	const admissionMap = releaseAdmissionMap(admission);
	const releaseVersion = generateReleaseManifest(admission, mode);

	const toolCount = validModules.filter((module) => module.pluginType === 'tool').length;
	const scriptCount = validModules.filter((module) => module.pluginType === 'script').length;
	const systemCount = validModules.filter((module) => module.pluginType === 'system').length;
	const admittedCount = admission.modules.length;

	console.log(
		`📦 Catalog: ${toolCount} Tools + ${scriptCount} Scripts + ${systemCount} System; `
		+ `release-admitted modules: ${admittedCount}`,
	);

	generateRegistry(validModules, manifestsMap, releaseVersion, mode);
	generateReleaseAdmissionProjection(admission, mode);
	generateBackgroundActiveProjection(validModules, manifestsMap, admissionMap, mode);
	generateScriptRuntimeManifest(validModules, manifestsMap, admissionMap, mode);
	generateLoader(validModules, admissionMap, mode);
	generateI18n(validModules, mode);

	console.log(`\n✨ Registry ${mode === 'check' ? 'check' : 'generation'} complete!`);
}

main();
