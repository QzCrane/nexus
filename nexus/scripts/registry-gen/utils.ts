// goal: Utility functions for registry generation
// eff: String conversion, size calculation, export detection

import fs from 'node:fs';
import path from 'node:path';

/**
 * Convert kebab-case to PascalCase
 */
export function toPascalCase(str) {
	return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

/**
 * Calculate total size of files in a directory recursively
 */
export function calculateFolderSize(dir) {
	let size = 0;
	if (!fs.existsSync(dir)) return 0;
	const files = fs.readdirSync(dir, { withFileTypes: true });
	for (const file of files) {
		const filePath = path.join(dir, file.name);
		if (file.isDirectory()) {
			size += calculateFolderSize(filePath);
		} else {
			size += fs.statSync(filePath).size;
		}
	}
	return size;
}

/**
 * Detect panel export name from panel.tsx content
 */
export function detectPanelExport(panelPath) {
	const content = fs.readFileSync(panelPath, 'utf-8');
	// Match: export const XxxPanel or export function XxxPanel
	const match = content.match(/export\s+(?:const|function)\s+(\w+Panel)/);
	if (match) return match[1];
	// Fallback: named export
	const namedMatch = content.match(/export\s*{\s*(\w+Panel)\s*}/);
	if (namedMatch) return namedMatch[1];
	return null;
}
