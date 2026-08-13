import { describe, expect, test } from 'bun:test';
import {
	analyzePermissionSurface,
	type PermissionSurface,
} from './permission-capabilities.ts';

function surface(overrides: Partial<PermissionSurface> = {}): PermissionSurface {
	return {
		appName: 'fixture',
		manifest: { permissions: ['storage'] },
		sourceFiles: { 'runtime.ts': 'void chrome.storage.local.get("value");' },
		privacyDocument: '### `storage`\n\nStores settings locally.\n',
		toolPermissionOwners: [],
		requireOptionalOwners: false,
		...overrides,
	};
}

describe('permission governance', () => {
	test('accepts a declared capability with syntax evidence and privacy ownership', () => {
		expect(analyzePermissionSurface(surface())).toEqual([]);
	});

	test('fails closed for unknown permissions', () => {
		const issues = analyzePermissionSurface(surface({
			manifest: { permissions: ['futurePower'] },
			privacyDocument: '### `futurePower`\n',
		}));
		expect(issues.some((issue) => issue.code === 'unknown-permission')).toBe(true);
	});

	test('does not accept a comment or locale string as runtime evidence', () => {
		const issues = analyzePermissionSurface(surface({
			manifest: { permissions: ['cookies'] },
			sourceFiles: { 'runtime.ts': '// chrome.cookies\nconst copy = "chrome.cookies";' },
			privacyDocument: '### `cookies`\n',
		}));
		expect(issues.some((issue) => issue.code === 'missing-runtime-evidence')).toBe(true);
	});

	test('rejects runtime APIs that have no manifest declaration', () => {
		const issues = analyzePermissionSurface(surface({
			sourceFiles: {
				'runtime.ts': 'void chrome.storage.local.get("value"); void chrome.cookies.getAll({});',
			},
		}));
		expect(issues.some((issue) => issue.code === 'undeclared-runtime-capability')).toBe(true);
	});

	test('requires every optional permission and origin to have a tool owner', () => {
		const issues = analyzePermissionSurface(surface({
			manifest: {
				permissions: ['storage'],
				optional_permissions: ['cookies'],
				optional_host_permissions: ['*://*/*'],
			},
			sourceFiles: {
				'runtime.ts': 'void chrome.storage.local.get("value"); void chrome.cookies.getAll({});',
			},
			privacyDocument: [
				'### `storage`',
				'### `cookies`',
				'### `userScripts` and optional host access',
			].join('\n\n'),
			requireOptionalOwners: true,
		}));
		expect(issues.filter((issue) => issue.code === 'optional-without-owner')).toHaveLength(2);
	});

	test('rejects tool permissions that the extension cannot grant', () => {
		const issues = analyzePermissionSurface(surface({
			toolPermissionOwners: [{ path: 'tools/cookie/manifest.json', permissions: ['cookies'] }],
		}));
		expect(issues.some((issue) => issue.code === 'owner-undeclared')).toBe(true);
	});

	test('models content-script and web-accessible host surfaces', () => {
		const issues = analyzePermissionSurface(surface({
			manifest: {
				permissions: ['storage'],
				content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
				web_accessible_resources: [{ matches: ['<all_urls>'], resources: ['runtime.js'] }],
			},
		}));
		expect(issues.some((issue) => issue.code === 'host-surface-undisclosed')).toBe(true);
		expect(analyzePermissionSurface(surface({
			manifest: {
				permissions: ['storage'],
				content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
			},
			privacyDocument: '### `storage`\n\nLocal.\n\n### content-script host access\n\nRuns the declared bundle.\n',
		}))).toEqual([]);
	});

	test('requires optional admission and exact permission UI parity', () => {
		const issues = analyzePermissionSurface(surface({
			manifest: { permissions: ['storage'], optional_permissions: ['cookies'] },
			privacyDocument: '### `storage`\n\nLocal.\n\n### `cookies`\n\nSelected site only.\n',
			toolPermissionOwners: [{ path: 'cookie/manifest.json', permissions: ['cookies'] }],
			requireOptionalOwners: true,
			optionalPermissionUiIds: ['history'],
		}));
		expect(issues.some((issue) => issue.code === 'optional-admission-missing')).toBe(true);
		expect(issues.some((issue) => issue.code === 'optional-ui-drift')).toBe(true);
	});
});
