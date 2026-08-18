#!/usr/bin/env node
// goal: Auto-generate HALO registry artifacts from manifest files
// eff: Canonical catalog plus release-admitted runtime projections

import { readFileSync } from 'node:fs';
import {
	HALO_MANIFEST,
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
import { normalizeReleaseStatus } from '../apps/extension-halo/src/kernel/registry/release-admission.ts';

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
	const releaseVersion = JSON.parse(readFileSync(HALO_MANIFEST, 'utf8')).version;
	if (typeof releaseVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(releaseVersion)) {
		throw new Error(`HALO manifest version is invalid: ${String(releaseVersion)}`);
	}

	for (const module of validModules) {
		const manifest = manifestsMap.get(module.id);
		const declaredType = manifest.pluginType;
		// Validate release status even while omitted legacy manifests still
		// normalize to ready for backward compatibility.
		normalizeReleaseStatus(manifest.status);
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

	const toolCount = validModules.filter((module) => module.pluginType === 'tool').length;
	const scriptCount = validModules.filter((module) => module.pluginType === 'script').length;
	const systemCount = validModules.filter((module) => module.pluginType === 'system').length;

	console.log(`📦 Found: ${toolCount} Tools + ${scriptCount} Scripts + ${systemCount} System`);

	generateRegistry(validModules, manifestsMap, releaseVersion, mode);
	generateBackgroundActiveProjection(validModules, manifestsMap, mode);
	generateScriptRuntimeManifest(validModules, manifestsMap, mode);
	generateLoader(validModules, manifestsMap, mode);
	generateI18n(validModules, mode);

	console.log(`\n✨ Registry ${mode === 'check' ? 'check' : 'generation'} complete!`);
}

main();
