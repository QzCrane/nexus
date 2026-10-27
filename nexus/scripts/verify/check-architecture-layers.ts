// goal: keep every projection surface independent so no view becomes a second authority
//
// Two surfaces that import each other can drift independently, and whichever
// rendered last is what the user sees. The declared surface list lives in
// `architecture-layers.json`; this check only proves the declaration holds.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const CONFIG_PATH = 'architecture-layers.json';

interface LayerException {
	readonly from: string;
	readonly to: string;
	readonly owner: string;
	readonly rationale: string;
	readonly decompositionTrigger: string;
}

interface LayerConfig {
	readonly schemaVersion: number;
	readonly scope: readonly string[];
	readonly surfaces: readonly string[];
	readonly exceptions: readonly LayerException[];
}

function readConfig(ROOT: string): LayerConfig {
	const parsed: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8'));
	const config = parsed as LayerConfig;
	if (!Array.isArray(config.surfaces) || config.surfaces.length === 0) {
		throw new Error(`${CONFIG_PATH} must declare at least one surface`);
	}
	return config;
}

function listSources(root: string): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'dist' || entry.name === 'node_modules') continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
			found.push(full.split(path.sep).join('/'));
		}
	};
	walk(root);
	return found;
}

function surfaceOf(rel: string, surfaces: readonly string[]): string | null {
	for (const surface of surfaces) {
		if (rel.startsWith(`${surface}/`)) return surface;
	}
	return null;
}

function importSpecifiers(source: string): string[] {
	// Relative specifiers only: bare package imports are governed by the
	// dependency-direction check, not by surface layering.
	const found = source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"](\.[^'"]*)['"]/gu);
	return [...found].map((match) => match[1] ?? '');
}

export function checkArchitectureLayers(ROOT: string): void {
	section('检查投影面分层（projection surface independence）...');
	const config = readConfig(ROOT);

	const allowed = new Set(
		config.exceptions.map((entry) => `${entry.from}->${entry.to}`),
	);
	const seen = new Set<string>();

	for (const scope of config.scope) {
		const absolute = path.join(ROOT, scope);
		if (!fs.existsSync(absolute)) continue;
		for (const file of listSources(absolute)) {
			const rel = file.slice(ROOT.length + 1);
			const from = surfaceOf(rel, config.surfaces);
			if (!from) continue;
			const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
			for (const specifier of importSpecifiers(source)) {
				const resolved = path.posix.normalize(
					path.posix.join(path.posix.dirname(rel), specifier),
				);
				const to = surfaceOf(`${resolved}.ts`, config.surfaces)
					?? surfaceOf(`${resolved}/index.ts`, config.surfaces)
					?? surfaceOf(resolved, config.surfaces);
				if (!to || to === from) continue;
				const edge = `${from}->${to}`;
				if (seen.has(edge)) continue;
				seen.add(edge);
				if (allowed.has(edge)) continue;
				error(`LAYER-001: projection surface ${from} imports ${to} in ${rel} — surfaces must not depend on each other`);
			}
		}
	}

	for (const entry of config.exceptions) {
		const edge = `${entry.from}->${entry.to}`;
		if (seen.has(edge)) continue;
		warn(`LAYER-002: exception ${edge} no longer occurs; remove it from ${CONFIG_PATH}`, true);
	}

	ok(`projection surfaces checked: ${config.surfaces.length} declared, ${seen.size} cross-surface edge(s), ${config.exceptions.length} registered`);
}
