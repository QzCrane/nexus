import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REMOTE_SITE_BASE_URL = 'https://nexus-remote.pages.dev';
export const REMOTE_SITE_BASE_URL_ENV = 'SPECTRA_REMOTE_SITE_BASE_URL';
export const REMOTE_SITE_ASSET_PATHS = Object.freeze([
	'index.html',
	'app.js',
	'dist/protocol.js',
	'styles.css',
	'vendor/peerjs.min.js',
]);
export const REMOTE_SITE_SECURITY_HEADER_NAMES = Object.freeze([
	'Content-Security-Policy',
	'Referrer-Policy',
	'Permissions-Policy',
	'X-Content-Type-Options',
	'X-Frame-Options',
	'Cross-Origin-Opener-Policy',
]);

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 10;
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultSiteDirectory = resolve(workspaceDir, '../remote-site');
const remoteSiteResources = Object.freeze([
	{
		assetPath: '/',
		localAssetPath: 'index.html',
		requestPath: '',
		contentTypes: Object.freeze(['text/html']),
	},
	{
		assetPath: 'index.html',
		localAssetPath: 'index.html',
		requestPath: 'index.html',
		contentTypes: Object.freeze(['text/html']),
	},
	{
		assetPath: 'app.js',
		localAssetPath: 'app.js',
		requestPath: 'app.js',
		contentTypes: Object.freeze(['application/javascript', 'text/javascript']),
	},
	{
		assetPath: 'dist/protocol.js',
		localAssetPath: 'dist/protocol.js',
		requestPath: 'dist/protocol.js',
		contentTypes: Object.freeze(['application/javascript', 'text/javascript']),
	},
	{
		assetPath: 'styles.css',
		localAssetPath: 'styles.css',
		requestPath: 'styles.css',
		contentTypes: Object.freeze(['text/css']),
	},
	{
		assetPath: 'vendor/peerjs.min.js',
		localAssetPath: 'vendor/peerjs.min.js',
		requestPath: 'vendor/peerjs.min.js',
		contentTypes: Object.freeze(['application/javascript', 'text/javascript']),
	},
]);

export class RemoteSiteDeploymentError extends Error {
	constructor(baseUrl, failures) {
		super([
			`SPECTRA remote-site live deployment gate failed for ${baseUrl}`,
			...failures.map((failure) => `- ${failure}`),
		].join('\n'));
		this.name = 'RemoteSiteDeploymentError';
		this.failures = failures;
	}
}

function extractAllPathHeaders(headersSource, headerNames) {
	const declarations = new Map(headerNames.map((headerName) => (
		[headerName.toLowerCase(), []]
	)));
	let activePath = '';
	for (const line of headersSource.replaceAll('\r\n', '\n').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		if (!/^\s/u.test(line)) {
			activePath = trimmed;
			continue;
		}
		if (activePath !== '/*') continue;
		const match = /^([^:]+?)\s*:\s*(.+)$/u.exec(trimmed);
		if (!match) continue;
		const headerName = match[1].trim().toLowerCase();
		declarations.get(headerName)?.push(match[2].trim());
	}

	const expectedHeaders = {};
	for (const headerName of headerNames) {
		const matches = declarations.get(headerName.toLowerCase()) ?? [];
		if (matches.length !== 1) {
			throw new Error(
				`remote-site/_headers must define exactly one /* ${headerName}, found ${matches.length}`,
			);
		}
		expectedHeaders[headerName] = matches[0];
	}
	return Object.freeze(expectedHeaders);
}

export function extractExpectedSecurityHeaders(headersSource) {
	return extractAllPathHeaders(headersSource, REMOTE_SITE_SECURITY_HEADER_NAMES);
}

export function extractExpectedContentSecurityPolicy(headersSource) {
	return extractAllPathHeaders(headersSource, ['Content-Security-Policy'])['Content-Security-Policy'];
}

function normalizeBaseUrl(value) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid remote-site base URL: ${value}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Remote-site base URL must use http or https: ${value}`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`Remote-site base URL must not include credentials, query, or fragment: ${value}`);
	}
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url;
}

export function parseRemoteSiteCheckArgs(
	args = process.argv.slice(2),
	environment = process.env,
) {
	let baseUrl = environment[REMOTE_SITE_BASE_URL_ENV] ?? DEFAULT_REMOTE_SITE_BASE_URL;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--help' || argument === '-h') {
			help = true;
			continue;
		}
		if (argument === '--base-url') {
			const value = args[index + 1];
			if (!value || value.startsWith('-')) throw new Error('--base-url requires a value');
			baseUrl = value;
			index += 1;
			continue;
		}
		if (argument.startsWith('--base-url=')) {
			baseUrl = argument.slice('--base-url='.length);
			if (!baseUrl) throw new Error('--base-url requires a value');
			continue;
		}
		throw new Error(`Unknown remote-site deployment check option: ${argument}`);
	}
	return { baseUrl: normalizeBaseUrl(baseUrl).href, help };
}

function sha256(data) {
	return createHash('sha256').update(data).digest('hex');
}

function isRedirectStatus(status) {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchAsset(fetchImplementation, url, timeoutMs, expectedOrigin) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		let currentUrl = url;
		for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
			const response = await fetchImplementation(currentUrl, {
				cache: 'no-store',
				headers: {
					'Cache-Control': 'no-cache',
					Pragma: 'no-cache',
				},
				redirect: 'manual',
				signal: controller.signal,
			});
			if (!isRedirectStatus(response.status)) return response;

			const location = response.headers.get('location');
			if (!location) return response;
			if (redirectCount === MAX_REDIRECTS) {
				throw new Error(`exceeded ${MAX_REDIRECTS} redirects`);
			}
			const redirectUrl = new URL(location, currentUrl);
			if (redirectUrl.origin !== expectedOrigin) {
				throw new Error(`redirected outside ${expectedOrigin} to ${redirectUrl.href}`);
			}
			currentUrl = redirectUrl;
		}
		throw new Error(`exceeded ${MAX_REDIRECTS} redirects`);
	} finally {
		clearTimeout(timeout);
	}
}

function contentTypeMediaType(contentType) {
	return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export async function verifyRemoteSiteDeployment({
	baseUrl = process.env[REMOTE_SITE_BASE_URL_ENV] ?? DEFAULT_REMOTE_SITE_BASE_URL,
	siteDirectory = defaultSiteDirectory,
	fetchImplementation = globalThis.fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	cacheToken = `${Date.now()}-${randomBytes(8).toString('hex')}`,
} = {}) {
	if (typeof fetchImplementation !== 'function') throw new Error('A fetch implementation is required');
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`Remote-site deployment timeout must be a positive integer, found ${timeoutMs}`);
	}
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const expectedHeaders = extractExpectedSecurityHeaders(
		readFileSync(resolve(siteDirectory, '_headers'), 'utf8'),
	);
	const expectedCsp = expectedHeaders['Content-Security-Policy'];
	const expectedOrigin = normalizedBaseUrl.origin;
	const resources = await Promise.all(remoteSiteResources.map(async (resource) => {
		const { assetPath, localAssetPath, requestPath, contentTypes } = resource;
		const localBytes = readFileSync(resolve(siteDirectory, ...localAssetPath.split('/')));
		const localSha256 = sha256(localBytes);
		const assetFailures = [];
		const requestUrl = new URL(requestPath, normalizedBaseUrl);
		requestUrl.searchParams.set('__spectra_release_check', cacheToken);
		try {
			const response = await fetchAsset(
				fetchImplementation,
				requestUrl,
				timeoutMs,
				expectedOrigin,
			);
			if (!response.ok) {
				assetFailures.push(`${assetPath} returned HTTP ${response.status}`);
				return {
					assetPath,
					localAssetPath,
					localSha256,
					remoteSha256: null,
					contentType: response.headers.get('content-type') ?? '',
					failures: assetFailures,
				};
			}
			if (response.url && new URL(response.url).origin !== expectedOrigin) {
				assetFailures.push(`${assetPath} redirected outside ${expectedOrigin} to ${response.url}`);
			}
			const contentType = response.headers.get('content-type')?.trim() ?? '';
			const mediaType = contentTypeMediaType(contentType);
			if (!contentTypes.includes(mediaType)) {
				assetFailures.push(
					`${assetPath} Content-Type mismatch (expected ${contentTypes.join(' or ')}, received ${JSON.stringify(contentType)})`,
				);
			}
			const remoteSha256 = sha256(Buffer.from(await response.arrayBuffer()));
			if (remoteSha256 !== localSha256) {
				assetFailures.push(
					`${assetPath} SHA-256 mismatch (local ${localSha256}, remote ${remoteSha256})`,
				);
			}
			for (const headerName of REMOTE_SITE_SECURITY_HEADER_NAMES) {
				const expectedValue = expectedHeaders[headerName];
				const actualValue = response.headers.get(headerName)?.trim() ?? '';
				if (actualValue !== expectedValue) {
					assetFailures.push(
						`${assetPath} ${headerName} mismatch (expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actualValue)})`,
					);
				}
			}
			return {
				assetPath,
				localAssetPath,
				localSha256,
				remoteSha256,
				contentType,
				failures: assetFailures,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			assetFailures.push(`${assetPath} request failed: ${message}`);
			return {
				assetPath,
				localAssetPath,
				localSha256,
				remoteSha256: null,
				contentType: '',
				failures: assetFailures,
			};
		}
	}));

	const failures = resources.flatMap((resource) => resource.failures);
	if (failures.length > 0) throw new RemoteSiteDeploymentError(normalizedBaseUrl.href, failures);
	const [root, ...files] = resources.map(({ failures: _failures, ...resource }) => resource);
	return {
		baseUrl: normalizedBaseUrl.href,
		expectedCsp,
		expectedHeaders,
		root,
		files,
	};
}

function printHelp() {
	console.log(`Verify that the deployed SPECTRA remote site exactly matches the local release source.

Usage:
  bun scripts/check-spectra-remote-live.ts [--base-url <http-or-https-url>]

Environment:
  ${REMOTE_SITE_BASE_URL_ENV}  Override ${DEFAULT_REMOTE_SITE_BASE_URL} (CLI takes precedence).`);
}

async function main() {
	const options = parseRemoteSiteCheckArgs();
	if (options.help) {
		printHelp();
		return;
	}
	const result = await verifyRemoteSiteDeployment({ baseUrl: options.baseUrl });
	console.log(`✓ SPECTRA remote site matches local assets, MIME types, and security headers: ${result.baseUrl}`);
	for (const file of [result.root, ...result.files]) {
		console.log(`  ${file.localSha256}  ${file.assetPath}  ${file.contentType}`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
