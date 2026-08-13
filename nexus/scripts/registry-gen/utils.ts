// goal: Utility functions for registry generation
// eff: String conversion, size calculation, export detection

import fs from 'node:fs';
import path from 'node:path';

export type GenerationMode = 'write' | 'check';

export function emitGeneratedFile(
	outputPath: string,
	content: string,
	mode: GenerationMode,
	label: string,
): void {
	if (mode === 'check') {
		if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== content) {
			throw new Error(`${label} generated projection is stale: ${path.relative(process.cwd(), outputPath)}`);
		}
		console.log(`✓ Checked ${label}: ${path.relative(process.cwd(), outputPath)}`);
		return;
	}
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, content, 'utf8');
	console.log(`✓ Generated ${label}: ${path.relative(process.cwd(), outputPath)}`);
}

/**
 * Convert kebab-case to PascalCase
 */
export function toPascalCase(str) {
	return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

/** Detect panel export name from panel.tsx content. */
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
