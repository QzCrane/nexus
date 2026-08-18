import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildCycloneDxBom, serializeCycloneDxBom } from './generate-sbom';

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe('deterministic Nexus CycloneDX SBOM', () => {
	test('captures exact installed dependency edges, licenses, and lock identity', () => {
		const workspace = mkdtempSync(resolve(tmpdir(), 'nexus-sbom-'));
		try {
			const nodeModules = resolve(workspace, 'node_modules');
			const foo = resolve(nodeModules, 'foo');
			const nestedBar = resolve(foo, 'node_modules/bar');
			mkdirSync(nestedBar, { recursive: true });
			writeJson(resolve(workspace, 'package.json'), {
				name: 'fixture-nexus',
				version: '1.2.3',
				private: true,
				dependencies: { foo: '^2.0.0' },
			});
			writeFileSync(resolve(workspace, 'bun.lock'), 'fixture-lock\n');
			writeJson(resolve(foo, 'package.json'), {
				name: 'foo',
				version: '2.0.1',
				license: 'MIT',
				dependencies: { bar: '^3.0.0' },
			});
			writeJson(resolve(nestedBar, 'package.json'), {
				name: 'bar',
				version: '3.4.5',
				license: 'Apache-2.0',
			});

			const first = buildCycloneDxBom({
				workspaceRoot: workspace,
				nodeModulesDir: nodeModules,
				lockfilePath: resolve(workspace, 'bun.lock'),
				bunVersion: '1.3.14',
			});
			const second = buildCycloneDxBom({
				workspaceRoot: workspace,
				nodeModulesDir: nodeModules,
				lockfilePath: resolve(workspace, 'bun.lock'),
				bunVersion: '1.3.14',
			});

			expect(serializeCycloneDxBom(first)).toBe(serializeCycloneDxBom(second));
			expect(first.bomFormat).toBe('CycloneDX');
			expect(first.specVersion).toBe('1.6');
			expect(first.metadata.component).toMatchObject({
				type: 'application',
				name: 'fixture-nexus',
				version: '1.2.3',
			});
			expect(first.metadata.properties).toContainEqual({
				name: 'nexus:bun-version',
				value: '1.3.14',
			});
			const fooRef = 'pkg:npm/foo@2.0.1';
			const barRef = 'pkg:npm/bar@3.4.5';
			expect(first.components).toContainEqual(expect.objectContaining({
				'bom-ref': fooRef,
				licenses: [{ expression: 'MIT' }],
			}));
			expect(first.components).toContainEqual(expect.objectContaining({
				'bom-ref': barRef,
				licenses: [{ expression: 'Apache-2.0' }],
			}));
			expect(first.dependencies).toContainEqual({
				ref: 'pkg:npm/fixture-nexus@1.2.3',
				dependsOn: [fooRef],
			});
			expect(first.dependencies).toContainEqual({ ref: fooRef, dependsOn: [barRef] });
		} finally {
			rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});
