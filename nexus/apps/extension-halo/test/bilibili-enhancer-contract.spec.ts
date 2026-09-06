import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
	new URL('../src/scripts/bilibili-enhancer/script.js', import.meta.url),
	'utf8',
);
const manifest = JSON.parse(readFileSync(
	new URL('../src/scripts/bilibili-enhancer/manifest.json', import.meta.url),
	'utf8',
)) as {
	status?: string;
	script?: { runAt?: string; matches?: string[] };
	background?: { mechanism?: string; sourceAnchor?: string };
};

describe('Bilibili Enhancer beta runtime contract', () => {
	test('keeps discovery bounded, coalesced and disposable', () => {
		expect(source).not.toContain('setInterval(');
		expect(source).toContain('observer = new MutationObserver(');
		expect(source).toMatch(/new MutationObserver\([\s\S]*if \(frameId \|\| disposed\) return;[\s\S]*requestAnimationFrame/u);
		expect(source).toContain('timeoutId = setTimeout(cleanup, 30000)');
		expect(source).toContain('observer?.disconnect()');
		expect(source).toContain('cancelAnimationFrame(frameId)');
		expect(source).toContain('clearTimeout(timeoutId)');
		expect(source).toMatch(/addEventListener\('pagehide'[\s\S]*stopSpeedDiscovery\?\.\(\)/u);
	});

	test('does not create duplicate control or focus owners', () => {
		expect(source).toContain("if (document.querySelector('.halo-speed-btn') || stopSpeedDiscovery) return");
		expect(source).toContain('if (navSearchform && !focusinBound)');
		expect(source).toContain('focusinBound = true');
		expect(source).toContain("if (document.querySelector('.halo-speed-btn')) return");
	});

	test('keeps the beta registration and provenance contract exact', () => {
		expect(manifest.status).toBe('beta');
		expect(manifest.script).toEqual({
			type: 'javascript',
			runAt: 'document_end',
			matches: ['*://www.bilibili.com/*', '*://live.bilibili.com/*'],
		});
		expect(manifest.background?.mechanism).toBe('mutation_observer');
		expect(manifest.background?.sourceAnchor).toBe('observer = new MutationObserver(');
	});
});
