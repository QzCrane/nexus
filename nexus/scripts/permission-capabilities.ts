import ts from 'typescript';

export const MANIFEST_PERMISSION_LISTS = [
	'permissions',
	'optional_permissions',
	'host_permissions',
	'optional_host_permissions',
] as const;

export type ManifestPermissionList = (typeof MANIFEST_PERMISSION_LISTS)[number];

interface PermissionCapability {
	runtimeReferences?: readonly string[];
	literalEvidence?: readonly string[];
	inferDeclaration?: boolean;
	implicitEvidence?: boolean;
}

// This is the repository's executable vocabulary for Chrome permission names.
// A new manifest permission must be modelled here before it can ship. Runtime
// references are collected from syntax nodes, so comments and locale strings
// cannot make an otherwise unused permission look exercised.
export const PERMISSION_CAPABILITIES = Object.freeze<Record<string, PermissionCapability>>({
	tabs: { runtimeReferences: ['chrome.tabs'] },
	activeTab: {
		runtimeReferences: ['chrome.tabs', 'chrome.scripting'],
		implicitEvidence: true,
	},
	alarms: { runtimeReferences: ['chrome.alarms'], inferDeclaration: true },
	webNavigation: { runtimeReferences: ['chrome.webNavigation'], inferDeclaration: true },
	storage: { runtimeReferences: ['chrome.storage'], inferDeclaration: true },
	downloads: { runtimeReferences: ['chrome.downloads'], inferDeclaration: true },
	tabCapture: { runtimeReferences: ['chrome.tabCapture'], inferDeclaration: true },
	offscreen: { runtimeReferences: ['chrome.offscreen'], inferDeclaration: true },
	userScripts: { runtimeReferences: ['chrome.userScripts'], inferDeclaration: true },
	scripting: { runtimeReferences: ['chrome.scripting'], inferDeclaration: true },
	favicon: { literalEvidence: ['_favicon/'] },
	sidePanel: { runtimeReferences: ['chrome.sidePanel'], inferDeclaration: true },
	contextMenus: { runtimeReferences: ['chrome.contextMenus'], inferDeclaration: true },
	declarativeNetRequest: {
		runtimeReferences: ['chrome.declarativeNetRequest'],
		inferDeclaration: true,
	},
	pageCapture: { runtimeReferences: ['chrome.pageCapture'], inferDeclaration: true },
	clipboardRead: {
		runtimeReferences: ['navigator.clipboard.read', 'navigator.clipboard.readText'],
	},
	clipboardWrite: {
		runtimeReferences: ['navigator.clipboard.write', 'navigator.clipboard.writeText'],
	},
	history: { runtimeReferences: ['chrome.history'], inferDeclaration: true },
	bookmarks: { runtimeReferences: ['chrome.bookmarks'], inferDeclaration: true },
	tabGroups: { runtimeReferences: ['chrome.tabGroups'], inferDeclaration: true },
	management: { runtimeReferences: ['chrome.management'], inferDeclaration: true },
	cookies: { runtimeReferences: ['chrome.cookies'], inferDeclaration: true },
	notifications: { runtimeReferences: ['chrome.notifications'], inferDeclaration: true },
	webRequest: { runtimeReferences: ['chrome.webRequest'], inferDeclaration: true },
	identity: { runtimeReferences: ['chrome.identity'], inferDeclaration: true },
	'<all_urls>': { implicitEvidence: true },
	'*://*/*': { implicitEvidence: true },
});

export interface PermissionManifest {
	permissions?: unknown;
	optional_permissions?: unknown;
	host_permissions?: unknown;
	optional_host_permissions?: unknown;
	content_scripts?: unknown;
	web_accessible_resources?: unknown;
}

export interface ToolPermissionOwner {
	path: string;
	permissions: unknown;
}

export interface PermissionSurface {
	appName: string;
	manifest: PermissionManifest;
	sourceFiles: Readonly<Record<string, string>>;
	privacyDocument: string;
	toolPermissionOwners?: readonly ToolPermissionOwner[];
	requireOptionalOwners?: boolean;
	optionalPermissionUiIds?: readonly string[];
	optionalHostUiIds?: readonly string[];
}

export interface PermissionIssue {
	code:
		| 'duplicate-declaration'
		| 'host-surface-invalid'
		| 'host-surface-undisclosed'
		| 'invalid-declaration'
		| 'missing-privacy-justification'
		| 'missing-runtime-evidence'
		| 'optional-without-owner'
		| 'optional-admission-missing'
		| 'optional-ui-drift'
		| 'owner-duplicate'
		| 'owner-invalid'
		| 'owner-undeclared'
		| 'undeclared-runtime-capability'
		| 'unknown-permission';
	message: string;
}

interface RuntimeEvidence {
	references: Set<string>;
	literals: Set<string>;
}

function permissionValues(value: unknown): string[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
	return value;
}

function referenceMatches(reference: string, expected: string): boolean {
	return reference === expected
		|| reference.startsWith(`${expected}.`)
		|| reference.startsWith(`${expected}?.`);
}

function collectRuntimeEvidence(sourceFiles: Readonly<Record<string, string>>): RuntimeEvidence {
	const references = new Set<string>();
	const literals = new Set<string>();

	for (const [filePath, source] of Object.entries(sourceFiles)) {
		const kind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
			? ts.ScriptKind.TSX
			: filePath.endsWith('.js') || filePath.endsWith('.mjs')
				? ts.ScriptKind.JS
				: ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
		const visit = (node: ts.Node): void => {
			if (ts.isPropertyAccessExpression(node)) references.add(node.getText(sourceFile));
			if (ts.isStringLiteralLike(node)) literals.add(node.text);
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}

	return { references, literals };
}

function capabilityHasEvidence(capability: PermissionCapability, evidence: RuntimeEvidence): boolean {
	if (capability.implicitEvidence) return true;
	const runtimeMatch = capability.runtimeReferences?.some((expected) =>
		[...evidence.references].some((reference) => referenceMatches(reference, expected)),
	) ?? false;
	const literalMatch = capability.literalEvidence?.some((expected) =>
		[...evidence.literals].some((literal) => literal.includes(expected)),
	) ?? false;
	return runtimeMatch || literalMatch;
}

function hasPrivacyJustification(
	document: string,
	permission: string,
	list: ManifestPermissionList,
): boolean {
	if (list === 'host_permissions') return /^### host permissions\s*$/imu.test(document);
	if (list === 'optional_host_permissions') return /^### `userScripts` and optional host access\s*$/imu.test(document);
	if (permission === 'clipboardRead' || permission === 'clipboardWrite') {
		return /^### `clipboardRead` and `clipboardWrite`\s*$/imu.test(document);
	}
	if (permission === 'userScripts') {
		return /^### `userScripts`(?: and optional host access)?\s*$/imu.test(document);
	}
	return document.includes(`### \`${permission}\``);
}

function collectHostSurfacePatterns(manifest: PermissionManifest, issues: PermissionIssue[], appName: string): string[] {
	const patterns: string[] = [];
	const contentScripts = manifest.content_scripts;
	if (contentScripts !== undefined) {
		if (!Array.isArray(contentScripts)) {
			issues.push({ code: 'host-surface-invalid', message: `${appName}: manifest.content_scripts must be an array` });
		} else {
			for (const [index, raw] of contentScripts.entries()) {
				if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
					issues.push({ code: 'host-surface-invalid', message: `${appName}: content_scripts[${index}] must be an object` });
					continue;
				}
				const entry = raw as Record<string, unknown>;
				const matches = permissionValues(entry.matches);
				const js = permissionValues(entry.js);
				const css = permissionValues(entry.css);
				if (matches === null || matches.length === 0
					|| (js === null && css === null)
					|| (js?.length ?? 0) + (css?.length ?? 0) === 0) {
					issues.push({ code: 'host-surface-invalid', message: `${appName}: content_scripts[${index}] needs string matches and executable files` });
					continue;
				}
				patterns.push(...matches);
			}
		}
	}

	const resources = manifest.web_accessible_resources;
	if (resources !== undefined) {
		if (!Array.isArray(resources)) {
			issues.push({ code: 'host-surface-invalid', message: `${appName}: manifest.web_accessible_resources must be an array` });
		} else {
			for (const [index, raw] of resources.entries()) {
				if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
					issues.push({ code: 'host-surface-invalid', message: `${appName}: web_accessible_resources[${index}] must be an object` });
					continue;
				}
				const entry = raw as Record<string, unknown>;
				const matches = permissionValues(entry.matches);
				const files = permissionValues(entry.resources);
				if (matches === null || matches.length === 0 || files === null || files.length === 0) {
					issues.push({ code: 'host-surface-invalid', message: `${appName}: web_accessible_resources[${index}] needs string matches and resources` });
					continue;
				}
				patterns.push(...matches);
			}
		}
	}
	return patterns;
}

export function analyzePermissionSurface(surface: PermissionSurface): PermissionIssue[] {
	const issues: PermissionIssue[] = [];
	const declared = new Map<string, ManifestPermissionList>();
	const declaredByList = new Map<ManifestPermissionList, string[]>();
	const hostSurfacePatterns = collectHostSurfacePatterns(surface.manifest, issues, surface.appName);
	if (hostSurfacePatterns.length > 0
		&& !/^### (?:content-script host access|host permissions)\s*$/imu.test(surface.privacyDocument)) {
		issues.push({
			code: 'host-surface-undisclosed',
			message: `${surface.appName}: content-script/web-accessible host surfaces lack a privacy owner`,
		});
	}

	for (const list of MANIFEST_PERMISSION_LISTS) {
		const values = permissionValues(surface.manifest[list]);
		if (values === null) {
			issues.push({
				code: 'invalid-declaration',
				message: `${surface.appName}: manifest.${list} must be an array of strings`,
			});
			declaredByList.set(list, []);
			continue;
		}
		declaredByList.set(list, values);
		const local = new Set<string>();
		for (const permission of values) {
			if (local.has(permission) || declared.has(permission)) {
				issues.push({
					code: 'duplicate-declaration',
					message: `${surface.appName}: ${permission} is declared more than once`,
				});
			}
			local.add(permission);
			declared.set(permission, list);
			if (!PERMISSION_CAPABILITIES[permission]) {
				issues.push({
					code: 'unknown-permission',
					message: `${surface.appName}: ${permission} has no executable capability model`,
				});
			}
			if (!hasPrivacyJustification(surface.privacyDocument, permission, list)) {
				issues.push({
					code: 'missing-privacy-justification',
					message: `${surface.appName}: ${permission} has no matching store privacy heading`,
				});
			}
		}
	}

	const evidence = collectRuntimeEvidence(surface.sourceFiles);
	const optionalDeclared = [
		...(declaredByList.get('optional_permissions') ?? []),
		...(declaredByList.get('optional_host_permissions') ?? []),
	];
	if (optionalDeclared.length > 0
		&& ![...evidence.references].some((reference) => referenceMatches(reference, 'chrome.permissions.request'))) {
		issues.push({
			code: 'optional-admission-missing',
			message: `${surface.appName}: optional permissions exist without a runtime permission-request admission path`,
		});
	}

	for (const [list, uiIds] of [
		['optional_permissions', surface.optionalPermissionUiIds],
		['optional_host_permissions', surface.optionalHostUiIds],
	] as const) {
		if (uiIds === undefined) continue;
		const manifestIds = [...(declaredByList.get(list) ?? [])].sort();
		const projectedIds = [...uiIds].sort();
		if (canonicalStrings(manifestIds) !== canonicalStrings(projectedIds)) {
			issues.push({
				code: 'optional-ui-drift',
				message: `${surface.appName}: ${list} differs from the permission UI projection`,
			});
		}
	}
	for (const [permission, list] of declared) {
		const capability = PERMISSION_CAPABILITIES[permission];
		if (!capability || capabilityHasEvidence(capability, evidence)) continue;
		issues.push({
			code: 'missing-runtime-evidence',
			message: `${surface.appName}: manifest.${list} declares ${permission}, but no runtime syntax evidence owns it`,
		});
	}

	for (const [permission, capability] of Object.entries(PERMISSION_CAPABILITIES)) {
		if (!capability.inferDeclaration || declared.has(permission)) continue;
		if (!capabilityHasEvidence(capability, evidence)) continue;
		issues.push({
			code: 'undeclared-runtime-capability',
			message: `${surface.appName}: runtime uses ${permission}, but the manifest does not declare it`,
		});
	}

	const ownerPermissions = new Map<string, string[]>();
	for (const owner of surface.toolPermissionOwners ?? []) {
		const values = permissionValues(owner.permissions);
		if (values === null) {
			issues.push({
				code: 'owner-invalid',
				message: `${surface.appName}: ${owner.path} permissions must be an array of strings`,
			});
			continue;
		}
		const local = new Set<string>();
		for (const permission of values) {
			if (local.has(permission)) {
				issues.push({
					code: 'owner-duplicate',
					message: `${surface.appName}: ${owner.path} repeats ${permission}`,
				});
			}
			local.add(permission);
			if (!PERMISSION_CAPABILITIES[permission]) {
				issues.push({
					code: 'unknown-permission',
					message: `${surface.appName}: ${owner.path} uses unknown permission ${permission}`,
				});
			}
			if (!declared.has(permission)) {
				issues.push({
					code: 'owner-undeclared',
					message: `${surface.appName}: ${owner.path} owns ${permission}, but the app manifest does not declare it`,
				});
			}
			const owners = ownerPermissions.get(permission) ?? [];
			owners.push(owner.path);
			ownerPermissions.set(permission, owners);
		}
	}

	if (surface.requireOptionalOwners) {
		for (const list of ['optional_permissions', 'optional_host_permissions'] as const) {
			for (const permission of declaredByList.get(list) ?? []) {
				if ((ownerPermissions.get(permission)?.length ?? 0) > 0) continue;
				issues.push({
					code: 'optional-without-owner',
					message: `${surface.appName}: manifest.${list} declares ${permission} without a tool/system owner`,
				});
			}
		}
	}

	return issues;
}

function canonicalStrings(values: readonly string[]): string {
	return JSON.stringify(values);
}
