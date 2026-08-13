// goal: fail closed when production extension copy exceeds verified product behavior
// inv: every shipped product projection is bounded, version-current, and privacy-consistent

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const spectraDir = resolve(workspaceDir, 'apps/extension-spectra');
const haloDir = resolve(workspaceDir, 'apps/extension-halo');
const forbiddenUniversalClaims = [
	/all websites/iu,
	/all sites/iu,
	/works on every website/iu,
	/compatible (?:with|on) all/iu,
	/kompatibel mit allen websites/iu,
	/compatible con todos los sitios/iu,
	/compatible avec tous les sites/iu,
	/全サイト対応/iu,
	/모든 사이트 호환/iu,
	/совместим со всеми сайтами/iu,
	/兼容所有(?:网站|網站)/u,
	/全站生效/u,
];

const failures: string[] = [];

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function requireText(path: string, needle: string, label: string): void {
	const text = readFileSync(path, 'utf8');
	if (!text.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function rejectUniversalClaim(text: string, label: string): void {
	if (forbiddenUniversalClaims.some((pattern) => pattern.test(text))) {
		failures.push(`${label}: universal compatibility claim: ${JSON.stringify(text.trim())}`);
	}
}

function checkSpectra(): number {
	const localesDir = resolve(spectraDir, 'public/_locales');
	const locales = readdirSync(localesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory());
	for (const locale of locales) {
		const messages = readJson(resolve(localesDir, locale.name, 'messages.json')) as {
			extDescription?: { message?: unknown };
		};
		const description = messages.extDescription?.message;
		if (typeof description !== 'string' || description.trim().length === 0) {
			failures.push(`SPECTRA ${locale.name}: missing extDescription.message`);
			continue;
		}
		rejectUniversalClaim(description, `SPECTRA ${locale.name}`);
	}

	requireText(
		resolve(spectraDir, 'store-listings/en-US.md'),
		'Availability depends on the page, media element, browser support, permissions, and user-activation rules.',
		'SPECTRA English store owner',
	);
	requireText(
		resolve(spectraDir, 'store-listings/zh-CN.md'),
		'具体能力取决于页面、媒体元素、浏览器支持、权限和用户激活条件。',
		'SPECTRA Chinese store owner',
	);
	const packageVersion = readJson(resolve(spectraDir, 'package.json')).version;
	if (typeof packageVersion !== 'string'
		|| !existsSync(resolve(spectraDir, `store-listings/release-notes-${packageVersion}.md`))) {
		failures.push(`SPECTRA: missing release notes for package version ${String(packageVersion)}`);
	}
	return locales.length;
}

function checkHalo(): void {
	const manifest = readJson(resolve(haloDir, 'public/manifest.json'));
	const packageVersion = readJson(resolve(haloDir, 'package.json')).version;
	if (manifest.version !== packageVersion) {
		failures.push(`HALO: package/manifest version mismatch ${String(packageVersion)} != ${String(manifest.version)}`);
	}
	if (manifest.name !== 'HALO - Local Utility SidePanel') {
		failures.push('HALO manifest: name must match the English store identity');
	}
	if (manifest.minimum_chrome_version !== '135') {
		failures.push('HALO manifest: chrome.userScripts.execute requires minimum Chrome 135');
	}
	const expectedDescription = 'Local-first SidePanel utilities with no ads or telemetry and explicit, user-invoked network tools.';
	if (manifest.description !== expectedDescription) {
		failures.push(`HALO manifest: description must remain the bounded local/network disclosure`);
	}
	if (typeof packageVersion !== 'string'
		|| !existsSync(resolve(haloDir, `store-listings/release-notes-${packageVersion}.md`))) {
		failures.push(`HALO: missing release notes for package version ${String(packageVersion)}`);
	}

	const hoverLocaleFiles = [
		resolve(haloDir, 'src/tools/hover-zoom/locales/en.ts'),
		resolve(haloDir, 'src/tools/hover-zoom/locales/zh.ts'),
	];
	for (const path of hoverLocaleFiles) rejectUniversalClaim(readFileSync(path, 'utf8'), `HALO ${path}`);
	requireText(
		resolve(haloDir, 'store-listings/en-US.md'),
		'## Name\n\nHALO - Local Utility SidePanel',
		'HALO English product identity',
	);
	requireText(
		resolve(haloDir, 'store-listings/en-US.md'),
		'HALO does not bypass browser security or promise identical behavior on every website.',
		'HALO English store owner',
	);
	requireText(
		resolve(haloDir, 'store-listings/en-US.md'),
		'site-cookie management',
		'HALO English permission projection',
	);
	requireText(
		resolve(haloDir, 'store-listings/zh-CN.md'),
		'HALO 不绕过浏览器安全机制，也不承诺每个网站都完全一致。',
		'HALO Chinese store owner',
	);
	requireText(
		resolve(haloDir, 'store-listings/zh-CN.md'),
		'当前网站 Cookie 管理',
		'HALO Chinese permission projection',
	);
	requireText(
		resolve(haloDir, 'PRIVACY.md'),
		'Cookie Manager keeps values inside the extension UI or a user-requested local export.',
		'HALO privacy owner',
	);
	const userScriptsEngine = readFileSync(
		resolve(haloDir, 'src/system/userscripts/engine.ts'),
		'utf8',
	);
	if (!userScriptsEngine.includes('chrome.userScripts.execute({')
		|| userScriptsEngine.includes('chrome.scripting.executeScript({')) {
		failures.push('HALO user-script Test path must use chrome.userScripts.execute, not scripting.executeScript');
	}
	requireText(
		resolve(haloDir, 'PRIVACY.md'),
		"Its saved execution world is either Chrome's isolated `USER_SCRIPT` world or the page-visible `MAIN` world",
		'HALO user-script execution-world disclosure',
	);
	for (const locale of ['en.ts', 'zh.ts']) {
		const text = readFileSync(resolve(haloDir, 'src/system/module-store/locales', locale), 'utf8');
		if (/\bInstall(?:ed|ing)?\b|\bUninstall\b|安装|卸载|已安装|未安装/iu.test(text)) {
			failures.push(`HALO Module Store ${locale}: bundled enablement must not claim install/uninstall`);
		}
	}
	requireText(
		resolve(haloDir, 'store-listings/privacy-justifications.md'),
		'`cookies`',
		'HALO permission projection',
	);
}

const spectraLocaleCount = checkSpectra();
checkHalo();

if (failures.length > 0) {
	throw new Error(`Public projection check failed:\n${failures.join('\n')}`);
}

console.log(
	`✓ Public projections: ${spectraLocaleCount} SPECTRA locale descriptions plus HALO manifest/store/privacy/release identity are bounded by verified behavior`,
);
