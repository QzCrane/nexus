import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SYSTEM_CORE_CONSUMERS,
	type BackgroundProfile,
	type ConsumptionMechanism,
} from '../src/system/resource-monitor/types';

const testDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(testDir, '../src');

function manifestProfiles(): Array<{ owner: string; profile: BackgroundProfile }> {
	const profiles: Array<{ owner: string; profile: BackgroundProfile }> = [];
	for (const rootName of ['tools', 'scripts', 'system']) {
		const root = join(srcRoot, rootName);
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const manifestPath = join(root, entry.name, 'manifest.json');
			if (!existsSync(manifestPath)) continue;
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
				id?: string;
				background?: BackgroundProfile;
			};
			if (manifest.background) {
				profiles.push({
					owner: manifest.id ?? `${rootName}/${entry.name}`,
					profile: manifest.background,
				});
			}
		}
	}
	return profiles;
}

function mechanismPattern(mechanism: ConsumptionMechanism): RegExp | null {
	switch (mechanism) {
		case 'interval_fast':
		case 'interval_slow':
			return /(?:setInterval|createSerializedAsyncPoller)\s*\(/u;
		case 'raf_active':
		case 'raf_idle':
			return /requestAnimationFrame\s*\(/u;
		case 'event_listener':
			return /(?:addEventListener|addListener)\s*\(/u;
		case 'storage_listener':
			return /(?:storage\.onChanged\.addListener|subscribeHaloStorageChanges)\s*\(/u;
		case 'message_listener':
			return /runtime\.onMessage\.addListener\s*\(/u;
		case 'wheel_listener':
			return /addEventListener\s*\(\s*['"]wheel['"]/u;
		case 'copy_listener':
			return /addEventListener\s*\(\s*['"]copy['"]/u;
		case 'mutation_observer':
			return /new\s+MutationObserver\s*\(/u;
		case 'service_worker':
		case 'content_script':
		case 'userscript':
			return null;
	}
}

function assertProfileSource(owner: string, profile: BackgroundProfile): void {
	const sourcePath = resolve(srcRoot, profile.sourceFile);
	expect(existsSync(sourcePath), `${owner}: missing ${profile.sourceFile}`).toBe(true);
	const lines = readFileSync(sourcePath, 'utf8').split(/\r?\n/u);
	expect(profile.sourceAnchor.trim().length, `${owner}: sourceAnchor must be non-empty`).toBeGreaterThan(0);
	const anchoredLines = lines
		.map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
		.filter(({ line }) => line.includes(profile.sourceAnchor));
	expect(
		anchoredLines.length,
		`${owner}: sourceAnchor not found in ${profile.sourceFile}: ${profile.sourceAnchor}`,
	).toBeGreaterThan(0);
	const pattern = mechanismPattern(profile.mechanism);
	if (pattern) {
		expect(
			anchoredLines.some(({ line }) => pattern.test(line)),
			`${owner}: ${profile.mechanism} anchor does not identify its mechanism in ${profile.sourceFile}: ${profile.sourceAnchor}`,
		).toBe(true);
	}
}

describe('HALO resource-impact provenance', () => {
	test('plugin profiles point at live mechanism owners', () => {
		const profiles = manifestProfiles();
		expect(profiles.length).toBeGreaterThan(0);
		for (const { owner, profile } of profiles) assertProfileSource(owner, profile);
	});

	test('system-core profiles point at live mechanism owners', () => {
		for (const consumer of SYSTEM_CORE_CONSUMERS) {
			for (const profile of consumer.profiles) {
				assertProfileSource(consumer.id, profile);
			}
		}
	});

	test('Resource Monitor does not claim a background mechanism of its own', () => {
		const manifest = JSON.parse(
			readFileSync(resolve(srcRoot, 'system/resource-monitor/manifest.json'), 'utf8'),
		) as { background?: unknown };
		expect(manifest.background).toBeUndefined();
	});

	test('presents provenance as an impact inventory rather than measured resource usage', () => {
		const locale = readFileSync(resolve(srcRoot, 'system/resource-monitor/locales/en.ts'), 'utf8');
		const panel = readFileSync(resolve(srcRoot, 'system/resource-monitor/panel.tsx'), 'utf8');
		expect(locale).toContain('Runtime Impact Inventory');
		expect(locale).toContain('not CPU or memory measurement');
		expect(panel).not.toContain('FULL monitoring');
	});
});
