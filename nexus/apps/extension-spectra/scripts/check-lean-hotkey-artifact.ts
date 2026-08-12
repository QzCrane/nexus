// goal: production ceiling for the injected configured-site lean hotkey host
// inv: the self-contained host must stay tiny enough that it cannot silently absorb the heavy Content Runtime

import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEAN_SITE_HOTKEY_ARTIFACT = 'content-site-hotkeys.js';
export const LEAN_SITE_HOTKEY_MAX_BYTES = 32 * 1024;

export function checkLeanSiteHotkeyArtifact(distDir: string): { bytes: number } {
	const path = resolve(distDir, LEAN_SITE_HOTKEY_ARTIFACT);
	const bytes = statSync(path).size;
	if (bytes > LEAN_SITE_HOTKEY_MAX_BYTES) {
		throw new Error(
			`${LEAN_SITE_HOTKEY_ARTIFACT}: ${bytes} bytes exceeds ${LEAN_SITE_HOTKEY_MAX_BYTES}-byte lean-host ceiling`,
		);
	}
	const source = readFileSync(path, 'utf8');
	if (/sourceMappingURL=/u.test(source)) {
		throw new Error(`${LEAN_SITE_HOTKEY_ARTIFACT}: production source-map reference is forbidden`);
	}
	return { bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
	const report = checkLeanSiteHotkeyArtifact(resolve(projectDir, 'dist'));
	console.log(`✓ Lean site-hotkey host: ${report.bytes} bytes <= ${LEAN_SITE_HOTKEY_MAX_BYTES}`);
}
