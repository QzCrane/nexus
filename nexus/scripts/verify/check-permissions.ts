import fs from 'node:fs';
import path from 'node:path';
import {
	analyzePermissionSurface,
	type PermissionManifest,
	type ToolPermissionOwner,
} from '../permission-capabilities.ts';
import { error, ok, section } from './utils.ts';
import {
	HOST_PERMISSIONS,
	OPTIONAL_PERMISSIONS,
} from '../../apps/extension-halo/src/kernel/managers/permission-definitions.ts';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRECTORIES = new Set(['dist', 'node_modules', '.turbo']);

function collectSourceFiles(directory: string, root = directory): Record<string, string> {
	const files: Record<string, string> = {};
	if (!fs.existsSync(directory)) return files;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			Object.assign(files, collectSourceFiles(fullPath, root));
			continue;
		}
		if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
		if (entry.name.startsWith('_generated')) continue;
		files[path.relative(root, fullPath).replaceAll('\\', '/')] = fs.readFileSync(fullPath, 'utf8');
	}
	return files;
}

function collectToolPermissionOwners(directory: string, root = directory): ToolPermissionOwner[] {
	const owners: ToolPermissionOwner[] = [];
	if (!fs.existsSync(directory)) return owners;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			owners.push(...collectToolPermissionOwners(fullPath, root));
			continue;
		}
		if (!entry.isFile() || entry.name !== 'manifest.json') continue;
		const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as { permissions?: unknown };
		if (manifest.permissions === undefined) continue;
		owners.push({
			path: path.relative(root, fullPath).replaceAll('\\', '/'),
			permissions: manifest.permissions,
		});
	}
	return owners;
}

export function checkPermissionUsage(root: string): void {
	section('检查 manifest 权限、运行时 owner 与商店隐私投影...');

	for (const appName of ['extension-spectra', 'extension-halo']) {
		const appRoot = path.join(root, 'apps', appName);
		const manifestPath = path.join(appRoot, 'public', 'manifest.json');
		const privacyPath = path.join(appRoot, 'store-listings', 'privacy-justifications.md');
		if (!fs.existsSync(manifestPath) || !fs.existsSync(privacyPath)) {
			error(`${appName}: manifest or store privacy owner is missing`);
			continue;
		}

		const issues = analyzePermissionSurface({
			appName,
			manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PermissionManifest,
			sourceFiles: collectSourceFiles(path.join(appRoot, 'src')),
			privacyDocument: fs.readFileSync(privacyPath, 'utf8'),
			toolPermissionOwners: appName === 'extension-halo'
				? collectToolPermissionOwners(path.join(appRoot, 'src'))
				: [],
			requireOptionalOwners: appName === 'extension-halo',
			optionalPermissionUiIds: appName === 'extension-halo'
				? OPTIONAL_PERMISSIONS.map((permission) => permission.id)
				: undefined,
			optionalHostUiIds: appName === 'extension-halo' ? [HOST_PERMISSIONS.id] : undefined,
		});

		if (issues.length > 0) {
			for (const issue of issues) error(`${issue.code}: ${issue.message}`);
			continue;
		}
		ok(`${appName}: 权限声明、运行时证据、工具 owner 与隐私说明一致`);
	}
}
