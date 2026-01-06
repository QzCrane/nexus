// goal: Discover plugins from directories
// eff: Scan tools/scripts/system directories, parse manifests

import fs from 'fs';
import path from 'path';

/**
 * Discover plugins with manifest.json
 * Supports Panel (manifest + panel.tsx) and Script (manifest + script.js/css)
 * @param {string} baseDir - Directory to scan
 * @param {'tools'|'scripts'|'system'} type - Plugin type from directory
 * @returns {Array} Discovered modules
 */
export function discoverPlugins(baseDir, type) {
	if (!fs.existsSync(baseDir)) return [];

	const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name);
	
	const modules = [];
	for (const dir of dirs) {
		const manifestPath = path.join(baseDir, dir, 'manifest.json');
		const panelPath = path.join(baseDir, dir, 'panel.tsx');
		const nestedPanelPath = path.join(baseDir, dir, 'components', 'ui', 'panel.tsx');
		const scriptJsPath = path.join(baseDir, dir, 'script.js');
		const scriptCssPath = path.join(baseDir, dir, 'script.css');
		const localesPath = path.join(baseDir, dir, 'locales');
		
		if (!fs.existsSync(manifestPath)) continue;
		
		// Parse manifest
		let manifest;
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		} catch { continue; }
		
		// Determine plugin type from new schema
		const pluginType = manifest.pluginType || (type === 'system' ? 'system' : (type === 'scripts' ? 'script' : 'tool'));
		const isScriptPlugin = pluginType === 'script';
		// Check both direct and nested panel paths
		const actualPanelPath = fs.existsSync(panelPath) ? panelPath : (fs.existsSync(nestedPanelPath) ? nestedPanelPath : null);
		const hasPanel = actualPanelPath !== null;
		const hasScript = fs.existsSync(scriptJsPath) || fs.existsSync(scriptCssPath);
		
		// Validate: script plugins need script file, panel plugins need panel.tsx
		if (isScriptPlugin ? hasScript : hasPanel) {
			modules.push({
				id: dir,
				pluginType,
				dirType: type, // Physical directory type
				manifestPath,
				panelPath: actualPanelPath,
				scriptPath: hasScript ? (fs.existsSync(scriptJsPath) ? scriptJsPath : scriptCssPath) : null,
				hasEn: fs.existsSync(path.join(localesPath, 'en.ts')),
				hasZh: fs.existsSync(path.join(localesPath, 'zh.ts'))
			});
		}
	}
	return modules;
}

/**
 * Parse manifest.json file
 */
export function parseManifest(filePath) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content);
	} catch (e) {
		console.warn(`⚠️ Failed to parse: ${filePath}`, e.message);
		return null;
	}
}
