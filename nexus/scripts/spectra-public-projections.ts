// goal: derive every SPECTRA public projection from one checked model
// inv: locale copy, privacy/network disclosure, manifest permissions, and the
// remote deployment surface must describe the same shipped capability set

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
	analyzePermissionSurface,
	type PermissionIssue,
	type PermissionManifest,
} from './permission-capabilities.ts';

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SOURCE_SKIP_DIRECTORIES = new Set(['.turbo', 'coverage', 'dist', 'node_modules', 'release']);
const STORE_LOCALE_PATTERN = /^(?<locale>[a-z]{2}-[A-Z]{2})\.md$/u;
const MESSAGE_LOCALE_PATTERN = /^[a-z]{2}(?:_[A-Z]{2})?$/u;

export const SPECTRA_NETWORK_PROVIDERS = Object.freeze([
	'Cloudflare Pages',
	'PeerJS',
	'STUN',
	'TURN',
]);

const UNIVERSAL_CLAIM_PATTERNS = Object.freeze([
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
]);

const AVAILABILITY_PATTERNS = Object.freeze([
	/availability/iu,
	/verfügbarkeit/iu,
	/disponibilidad/iu,
	/disponibilité/iu,
	/利用可否/iu,
	/사용 가능 여부/iu,
	/доступность/iu,
	/可用性/iu,
	/具体能力/iu,
]);

const REMOTE_PATTERNS = Object.freeze([
	/remote/iu,
	/remoto/iu,
	/fern(?:bedienung|steuerung)?/iu,
	/mando/iu,
	/télécommande/iu,
	/リモコン/iu,
	/리모컨/iu,
	/пульт/iu,
	/遥控/iu,
	/遙控/iu,
]);

const NON_TRANSMISSION_PATTERNS = Object.freeze([
	/not sent/iu,
	/ne transmet/iu,
	/no envía/iu,
	/nicht über/iu,
	/送信されません/iu,
	/전송되지/iu,
	/не отправ/iu,
	/不发送/iu,
	/不傳送/iu,
]);

export interface SpectraLocaleProjection {
	locale: string;
	messageLocale: string;
	listingPath: string;
	messagePath: string;
	name: string;
	description: string;
	listingText: string;
}

export interface SpectraProjectionNetwork {
	providers: readonly string[];
	privacyProviderCoverage: readonly string[];
	privacyJustificationProviderCoverage: readonly string[];
	listingProviderCoverage: Readonly<Record<string, readonly string[]>>;
	remoteCspValid: boolean;
}

export interface SpectraProjectionModel {
	spectraDir: string;
	packageVersion: string | undefined;
	manifest: PermissionManifest;
	locales: readonly SpectraLocaleProjection[];
	privacyDocument: string;
	privacyJustifications: string;
	network: SpectraProjectionNetwork;
	permissionIssues: readonly PermissionIssue[];
	failures: readonly string[];
}

export interface SpectraProjectionOptions {
	remoteSiteDir?: string;
}

function readJson(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function readText(path: string): string {
	return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function normalizeMessageLocale(locale: string, listingLocales: readonly string[]): string {
	const direct = locale.replace('_', '-');
	if (listingLocales.includes(direct)) return direct;
	if (!locale.includes('_')) {
		const languageMatch = listingLocales.find((candidate) => candidate.startsWith(`${locale}-`));
		if (languageMatch) return languageMatch;
	}
	return direct;
}

function collectSourceFiles(directory: string, root = directory): Record<string, string> {
	const files: Record<string, string> = {};
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && SOURCE_SKIP_DIRECTORIES.has(entry.name)) continue;
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			Object.assign(files, collectSourceFiles(fullPath, root));
			continue;
		}
		if (!entry.isFile() || !CODE_EXTENSIONS.has(extname(entry.name))) continue;
		if (entry.name.startsWith('_generated')) continue;
		files[fullPath.slice(root.length + 1).replaceAll('\\', '/')] = readFileSync(fullPath, 'utf8');
	}
	return files;
}

function providerCoverage(text: string): string[] {
	return SPECTRA_NETWORK_PROVIDERS.filter((provider) => text.includes(provider));
}

function makeLocaleProjection(
	locale: string,
	messageLocale: string,
	listingPath: string,
	messagePath: string,
	failures: string[],
): SpectraLocaleProjection {
	const listingText = readText(listingPath);
	const messages = readJson(messagePath);
	const name = (messages?.extName as { message?: unknown } | undefined)?.message;
	const description = (messages?.extDescription as { message?: unknown } | undefined)?.message;
	if (typeof name !== 'string' || name.trim().length === 0) {
		failures.push(`SPECTRA ${locale}: missing extName.message`);
	}
	if (typeof description !== 'string' || description.trim().length === 0) {
		failures.push(`SPECTRA ${locale}: missing extDescription.message`);
	}
	for (const [label, pattern] of [
		['availability', AVAILABILITY_PATTERNS],
		['optional remote', REMOTE_PATTERNS],
		['authenticated remote', [/HMAC-SHA-256/iu]],
		['non-transmission boundary', NON_TRANSMISSION_PATTERNS],
	] as const) {
		if (!pattern.some((candidate) => candidate.test(listingText))) {
			failures.push(`SPECTRA ${locale}: store listing misses ${label} fact`);
		}
	}
	for (const provider of SPECTRA_NETWORK_PROVIDERS) {
		if (!listingText.includes(provider)) failures.push(`SPECTRA ${locale}: store listing misses network provider ${provider}`);
	}
	if (typeof description === 'string') {
		if (!REMOTE_PATTERNS.some((pattern) => pattern.test(description))) {
			failures.push(`SPECTRA ${locale}: extDescription misses optional remote fact`);
		}
		if (!AVAILABILITY_PATTERNS.some((pattern) => pattern.test(description))) {
			failures.push(`SPECTRA ${locale}: extDescription misses availability fact`);
		}
		if (UNIVERSAL_CLAIM_PATTERNS.some((pattern) => pattern.test(description))) {
			failures.push(`SPECTRA ${locale}: extDescription contains a universal compatibility claim`);
		}
	}
	if (UNIVERSAL_CLAIM_PATTERNS.some((pattern) => pattern.test(listingText))) {
		failures.push(`SPECTRA ${locale}: store listing contains a universal compatibility claim`);
	}
	return {
		locale,
		messageLocale,
		listingPath,
		messagePath,
		name: typeof name === 'string' ? name : '',
		description: typeof description === 'string' ? description : '',
		listingText,
	};
}

function permissionProjectionIssues(
	spectraDir: string,
	manifest: PermissionManifest,
	privacyJustifications: string,
): PermissionIssue[] {
	return analyzePermissionSurface({
		appName: 'extension-spectra',
		manifest,
		sourceFiles: collectSourceFiles(resolve(spectraDir, 'src')),
		privacyDocument: privacyJustifications,
	});
}

export function buildSpectraProjectionModel(
	spectraDir: string,
	{ remoteSiteDir = resolve(resolve(spectraDir), '../..', '..', 'remote-site') }: SpectraProjectionOptions = {},
): SpectraProjectionModel {
	const root = resolve(spectraDir);
	const failures: string[] = [];
	const packageJson = readJson(resolve(root, 'package.json'));
	const packageVersion = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
	if (!packageVersion) failures.push('SPECTRA: package.json version is missing');
	const manifest = readJson(resolve(root, 'public/manifest.json')) as PermissionManifest | undefined;
	if (!manifest) failures.push('SPECTRA: public/manifest.json is missing or malformed');
	const privacyPath = resolve(root, 'PRIVACY.md');
	const privacyJustificationsPath = resolve(root, 'store-listings/privacy-justifications.md');
	const privacyDocument = readText(privacyPath);
	const privacyJustifications = readText(privacyJustificationsPath);
	if (!privacyDocument) failures.push('SPECTRA: PRIVACY.md is missing or empty');
	if (!privacyJustifications) failures.push('SPECTRA: store privacy justifications are missing or empty');

	const listingsDirectory = resolve(root, 'store-listings');
	const localeEntries = existsSync(listingsDirectory)
		? readdirSync(listingsDirectory, { withFileTypes: true })
			.filter((entry) => entry.isFile() && STORE_LOCALE_PATTERN.test(entry.name))
			.map((entry) => ({
				locale: STORE_LOCALE_PATTERN.exec(entry.name)?.groups?.locale ?? entry.name,
				path: resolve(listingsDirectory, entry.name),
			}))
			.sort((left, right) => left.locale.localeCompare(right.locale))
		: [];
	const listingLocaleNames = localeEntries.map((entry) => entry.locale);
	const messageDirectory = resolve(root, 'public/_locales');
	const messageEntries = existsSync(messageDirectory)
		? readdirSync(messageDirectory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && MESSAGE_LOCALE_PATTERN.test(entry.name))
			.map((entry) => ({
				locale: normalizeMessageLocale(entry.name, listingLocaleNames),
				messageLocale: entry.name,
				path: resolve(messageDirectory, entry.name, 'messages.json'),
			}))
			.sort((left, right) => left.locale.localeCompare(right.locale))
		: [];
	const listingLocales = new Set(localeEntries.map((entry) => entry.locale));
	const messageLocales = new Set(messageEntries.map((entry) => entry.locale));
	for (const locale of listingLocales) {
		if (!messageLocales.has(locale)) failures.push(`SPECTRA ${locale}: store listing has no matching _locales projection`);
	}
	for (const locale of messageLocales) {
		if (!listingLocales.has(locale)) failures.push(`SPECTRA ${locale}: _locales has no matching store listing`);
	}
	const locales: SpectraLocaleProjection[] = [];
	for (const listing of localeEntries) {
		const message = messageEntries.find((entry) => entry.locale === listing.locale);
		if (!message) continue;
		locales.push(makeLocaleProjection(
			listing.locale,
			message.messageLocale,
			listing.path,
			message.path,
			failures,
		));
	}
	if (locales.length === 0) failures.push('SPECTRA: no locale projections were found');

	for (const [label, text] of [
		['privacy policy', privacyDocument],
		['store privacy justifications', privacyJustifications],
	] as const) {
		for (const provider of SPECTRA_NETWORK_PROVIDERS) {
			if (!text.includes(provider)) failures.push(`SPECTRA ${label}: missing network provider ${provider}`);
		}
		if (!/off by default|默认关闭|預設關閉|既定でオフ|기본적으로 꺼져|по умолчанию выключен/iu.test(text)) {
			failures.push(`SPECTRA ${label}: missing optional/off-by-default network boundary`);
		}
	}
	if (!/does not send|does not transmit|不发送|不傳送|送信されません|전송되지|не отправ/iu.test(privacyDocument)) {
		failures.push('SPECTRA privacy policy: missing remote non-transmission boundary');
	}
	const remoteIndex = readText(resolve(remoteSiteDir, 'index.html'));
	const remoteCspValid = /script-src\s+'self'/iu.test(remoteIndex)
		&& /connect-src[^>]*(?:0\.peerjs\.com|stun:|turn:)/iu.test(remoteIndex)
		&& !/<script\b[^>]*\bsrc\s*=\s*["']https?:/iu.test(remoteIndex);
	if (!remoteCspValid) failures.push('SPECTRA remote-site: CSP/resource projection is not self-contained and provider-bounded');

	const permissionIssues = manifest
		? permissionProjectionIssues(root, manifest, privacyJustifications)
		: [];
	for (const issue of permissionIssues) failures.push(`${issue.code}: ${issue.message}`);
	if (packageVersion && !existsSync(resolve(listingsDirectory, `release-notes-${packageVersion}.md`))) {
		failures.push(`SPECTRA: missing release notes for package version ${packageVersion}`);
	}
	const listingProviderCoverage = Object.fromEntries(
		locales.map((locale) => [locale.locale, providerCoverage(locale.listingText)]),
	) as Record<string, readonly string[]>;
	return {
		spectraDir: root,
		packageVersion,
		manifest: manifest ?? {},
		locales,
		privacyDocument,
		privacyJustifications,
		network: {
			providers: SPECTRA_NETWORK_PROVIDERS,
			privacyProviderCoverage: providerCoverage(privacyDocument),
			privacyJustificationProviderCoverage: providerCoverage(privacyJustifications),
			listingProviderCoverage,
			remoteCspValid,
		},
		permissionIssues,
		failures: [...new Set(failures)].sort(),
	};
}

export function checkSpectraProjectionModel(spectraDir: string): SpectraProjectionModel {
	const model = buildSpectraProjectionModel(spectraDir);
	if (model.failures.length > 0) {
		throw new Error(`SPECTRA projection model failed:\n${model.failures.join('\n')}`);
	}
	return model;
}
