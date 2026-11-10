// goal: launch every formal Chromium test through one owner that records browser-returned execution identity
// inv: requested paths select a browser but never certify which executable actually ran

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-compiler-api';
import type { Browser as PuppeteerBrowser, LaunchOptions as PuppeteerLaunchOptions } from 'puppeteer';
import type {
	BrowserContext,
	BrowserType,
	LaunchPersistentContextOptions,
} from '@playwright/test';
import { browserReplayPolicy } from './browser-replay';
import { packageScriptTokens } from './check-release-test-owners';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PLATFORM_PATTERN = /^(?:aix|android|cygwin|darwin|freebsd|haiku|linux|netbsd|openbsd|sunos|win32)$/u;
const ARCH_PATTERN = /^(?:arm|arm64|ia32|loong64|mips|mipsel|ppc|ppc64|riscv64|s390|s390x|x64)$/u;
const EVIDENCE_PREFIX = 'browser-launch';
const spectraRequire = createRequire(resolve(workspaceDir, 'apps/extension-spectra/package.json'));
const executableEvidenceCache = new Map<string, BrowserLaunchIdentity['executable']>();

export interface BrowserProfileConstruction {
	kind: 'temporary';
	prefix: string;
	isolated: true;
}

export interface BrowserEvidenceContext {
	head: string;
	tree: string;
	run: string;
	attempt: number;
	outputDir: string;
	required: boolean;
}

export type ObservedProfile =
	| { status: 'matched' }
	| { status: 'unknown'; reason: string };

export interface BrowserLaunchIdentity {
	schemaVersion: 1;
	owner: string;
	driver: 'playwright' | 'puppeteer-current' | 'puppeteer-floor';
	head: string;
	tree: string;
	run: string;
	attempt: number;
	executionSequence: number;
	platform: NodeJS.Platform;
	arch: string;
	browserVersion: string;
	executable:
		| { status: 'observed'; basename: string; bytes: number; informationalSha256: string }
		| { status: 'unknown'; reason: string };
	effectiveArgs: string[] | { status: 'unknown'; reason: string };
	profile: BrowserProfileConstruction & { commandLine: ObservedProfile };
}

type PuppeteerReplayOptions = Pick<
	PuppeteerLaunchOptions,
	'executablePath' | 'headless' | 'userDataDir' | 'defaultViewport' | 'args' | 'enableExtensions'
>;

export interface BrowserLaunchOwner {
	owner: string;
	profile: BrowserProfileConstruction;
}

function safeOwner(value: string): string {
	if (!value || value.includes('..') || value.includes('\\') || value.startsWith('/')
		|| !/^[a-z0-9./_-]+$/u.test(value)) throw new Error(`invalid browser launch owner: ${value}`);
	return value;
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127;
	});
}

export function browserEvidenceContext(environment: NodeJS.ProcessEnv = process.env): BrowserEvidenceContext | null {
	const required = environment.NEXUS_BROWSER_EVIDENCE_REQUIRED === '1';
	const head = environment.NEXUS_BROWSER_EVIDENCE_HEAD?.trim();
	const tree = environment.NEXUS_BROWSER_EVIDENCE_TREE?.trim();
	const run = environment.NEXUS_BROWSER_EVIDENCE_RUN?.trim();
	const attempt = Number(environment.NEXUS_BROWSER_EVIDENCE_ATTEMPT);
	const outputDir = environment.NEXUS_BROWSER_EVIDENCE_OUTPUT_DIR?.trim();
	const complete = SHA_PATTERN.test(head ?? '') && SHA_PATTERN.test(tree ?? '')
		&& Boolean(run) && (run?.length ?? 0) <= 128 && !hasControlCharacters(run ?? '')
		&& Number.isInteger(attempt) && attempt > 0 && Boolean(outputDir);
	if (!complete) {
		if (required) throw new Error('formal browser launch evidence context is incomplete');
		return null;
	}
	if (!head || !tree || !run || !outputDir) {
		throw new Error('formal browser launch evidence context passed an inconsistent completeness check');
	}
	return { head, tree, run, attempt, outputDir: resolve(outputDir), required };
}

export function sanitizeBrowserArgument(argument: string): string {
	const equals = argument.indexOf('=');
	if (equals < 0) return argument;
	const name = argument.slice(0, equals);
	const value = argument.slice(equals + 1);
	if (name === '--user-data-dir') return `${name}=<temporary-profile>`;
	if (name === '--load-extension' || name === '--disable-extensions-except') {
		const absolute = resolve(value);
		const workspaceRelative = relative(workspaceDir, absolute).replaceAll('\\', '/');
		return `${name}=${workspaceRelative && !workspaceRelative.startsWith('../') ? workspaceRelative : `<external:${basename(absolute)}>`}`;
	}
	return argument;
}

export function sanitizeBrowserArguments(arguments_: string[]): string[] {
	const sanitized: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (!argument) continue;
		if (argument === '--user-data-dir') {
			sanitized.push('--user-data-dir=<temporary-profile>');
			index += 1;
			continue;
		}
		if ((argument === '--load-extension' || argument === '--disable-extensions-except')
			&& arguments_[index + 1]) {
			sanitized.push(sanitizeBrowserArgument(`${argument}=${arguments_[index + 1]}`));
			index += 1;
			continue;
		}
		sanitized.push(sanitizeBrowserArgument(argument));
	}
	return sanitized;
}

export function browserExecutableEvidence(command: string | undefined): BrowserLaunchIdentity['executable'] {
	if (!command || command.startsWith('-')) {
		return { status: 'unknown', reason: 'browser-command-line-omitted-executable' };
	}
	const path = resolve(command);
	if (!existsSync(path)) return { status: 'unknown', reason: 'browser-command-executable-unreadable' };
	const before = statSync(path);
	const cacheKey = `${path}\0${before.size}\0${before.mtimeMs}\0${before.ctimeMs}`;
	const cached = executableEvidenceCache.get(cacheKey);
	if (cached) return cached;
	const evidence: BrowserLaunchIdentity['executable'] = {
		status: 'observed',
		basename: basename(path),
		bytes: before.size,
		informationalSha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
	};
	const after = statSync(path);
	if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
		throw new Error('browser executable changed while its launch identity was being read');
	}
	executableEvidenceCache.set(cacheKey, evidence);
	return evidence;
}

export function profileCommandLineEvidence(arguments_: string[] | null | undefined, requestedPath: string): ObservedProfile {
	if (!arguments_) return { status: 'unknown', reason: 'browser-command-line-unavailable' };
	let actual: string | undefined;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--user-data-dir') actual = arguments_[index + 1];
		else if (argument?.startsWith('--user-data-dir=')) actual = argument.slice('--user-data-dir='.length);
	}
	if (!actual) return { status: 'unknown', reason: 'browser-command-line-omitted-profile' };
	if (resolve(actual) !== resolve(requestedPath)) {
		throw new Error('browser command line used a different profile than the requested isolated profile');
	}
	return { status: 'matched' };
}

export function assertExpectedBrowserVersion(browserVersion: string, expected: string | undefined): void {
	if (expected && browserVersion.split('/').pop() !== expected) {
		throw new Error(`Browser replay version mismatch: expected ${expected}, got ${browserVersion}`);
	}
}

export function writeBrowserLaunchEvidence(
	context: BrowserEvidenceContext | null,
	input: Omit<BrowserLaunchIdentity, 'head' | 'tree' | 'run' | 'attempt' | 'executionSequence'>,
): void {
	if (!context) return;
	if (context.required && (input.executable.status !== 'observed'
		|| !Array.isArray(input.effectiveArgs) || input.profile.commandLine.status !== 'matched')) {
		throw new Error('formal browser launch evidence requires executable, arguments, and profile readback');
	}
	mkdirSync(context.outputDir, { recursive: true });
	const owner = safeOwner(input.owner);
	const fileOwner = owner.replaceAll('/', '__');
	const runIdentity = createHash('sha256').update(context.run).digest('hex').slice(0, 16);
	for (let executionSequence = 1; executionSequence <= 10_000; executionSequence += 1) {
		const path = resolve(
			context.outputDir,
			`${EVIDENCE_PREFIX}.${context.head}.${runIdentity}.attempt-${context.attempt}.${fileOwner}.${executionSequence}.json`,
		);
		const body: BrowserLaunchIdentity = {
			...input,
			head: context.head,
			tree: context.tree,
			run: context.run,
			attempt: context.attempt,
			executionSequence,
		};
		parseBrowserLaunchIdentity(body);
		try {
			writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
	}
	throw new Error(`browser launch evidence sequence exhausted for ${owner}`);
}

async function inspectPlaywrightContext(context: BrowserContext): Promise<{
	version: string;
	commandLine: string[] | null;
}> {
	let page = context.pages()[0];
	let createdPage = false;
	if (!page) {
		page = await context.newPage();
		createdPage = true;
	}
	const session = await context.newCDPSession(page);
	try {
		const version = await session.send('Browser.getVersion') as { product?: unknown };
		if (typeof version.product !== 'string' || !version.product) {
			throw new Error('Playwright browser returned no runtime version');
		}
		let commandLine: string[] | null = null;
		try {
			const command = await session.send('Browser.getBrowserCommandLine') as { arguments?: unknown };
			if (Array.isArray(command.arguments)
				&& command.arguments.every((item) => typeof item === 'string')) commandLine = command.arguments;
		} catch {
			commandLine = null;
		}
		return { version: version.product, commandLine };
	} finally {
		await session.detach();
		if (createdPage) await page.close();
	}
}

export async function launchPuppeteerBrowser(
	options: PuppeteerReplayOptions,
	evidence: BrowserLaunchOwner,
): Promise<PuppeteerBrowser> {
	const evidenceContext = browserEvidenceContext();
	if (!options.userDataDir) throw new Error('Puppeteer browser launch requires an isolated profile directory');
	const expected = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
	const policy = browserReplayPolicy(expected, options.executablePath, process.platform);
	const rootArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
	const extensionFixture = options.args?.some((argument) => argument.startsWith('--load-extension='));
	const launchOptions = {
		...options,
		...(extensionFixture ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
		args: [...new Set([...(options.args ?? []), ...policy.args, ...rootArgs])],
	};
	const current = spectraRequire('puppeteer') as { default?: { launch(options: unknown): Promise<PuppeteerBrowser> }; launch?(options: unknown): Promise<PuppeteerBrowser> };
	const floor = spectraRequire('puppeteer-floor') as { default?: { launch(options: unknown): Promise<PuppeteerBrowser> }; launch?(options: unknown): Promise<PuppeteerBrowser> };
	const driver = (policy.driver === 'floor' ? (floor.default ?? floor) : (current.default ?? current)) as {
		launch(options: unknown): Promise<PuppeteerBrowser>;
	};
	const browser = await driver.launch(launchOptions);
	try {
		const browserVersion = await browser.version();
		assertExpectedBrowserVersion(browserVersion, expected);
		const processOwner = browser.process();
		const spawnArgs = processOwner?.spawnargs;
		const profileReadback = profileCommandLineEvidence(spawnArgs, options.userDataDir);
		writeBrowserLaunchEvidence(evidenceContext, {
			schemaVersion: 1,
			owner: safeOwner(evidence.owner),
			driver: policy.driver === 'floor' ? 'puppeteer-floor' : 'puppeteer-current',
			platform: process.platform,
			arch: process.arch,
			browserVersion,
			executable: browserExecutableEvidence(processOwner?.spawnfile),
			effectiveArgs: spawnArgs
				? sanitizeBrowserArguments(spawnArgs.slice(spawnArgs[0] === processOwner?.spawnfile ? 1 : 0))
				: { status: 'unknown', reason: 'puppeteer-process-arguments-unavailable' },
			profile: { ...evidence.profile, commandLine: profileReadback },
		});
		return browser;
	} catch (error) {
		await browser.close().catch(() => undefined);
		throw error;
	}
}

export async function launchPlaywrightPersistentContext(
	browserType: BrowserType,
	profilePath: string,
	options: LaunchPersistentContextOptions,
	evidence: BrowserLaunchOwner,
): Promise<BrowserContext> {
	const evidenceContext = browserEvidenceContext();
	const context = await browserType.launchPersistentContext(profilePath, options);
	try {
		const observed = await inspectPlaywrightContext(context);
		const expected = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
		assertExpectedBrowserVersion(observed.version, expected);
		const command = observed.commandLine;
		const executableCandidate = command?.[0] && !command[0].startsWith('-') ? command[0] : undefined;
		const commandArguments = command?.slice(executableCandidate ? 1 : 0);
		const profileReadback = profileCommandLineEvidence(commandArguments, profilePath);
		writeBrowserLaunchEvidence(evidenceContext, {
			schemaVersion: 1,
			owner: safeOwner(evidence.owner),
			driver: 'playwright',
			platform: process.platform,
			arch: process.arch,
			browserVersion: observed.version,
			executable: browserExecutableEvidence(executableCandidate),
			effectiveArgs: commandArguments
				? sanitizeBrowserArguments(commandArguments)
				: { status: 'unknown', reason: 'browser-command-line-unavailable' },
			profile: { ...evidence.profile, commandLine: profileReadback },
		});
		return context;
	} catch (error) {
		await context.close().catch(() => undefined);
		throw error;
	}
}

function stringLiterals(source: string, fileName: string): string[] {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const values: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isStringLiteralLike(node)) values.push(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return values;
}

interface ImportBinding { module: string; imported: string }

function rootIdentifier(expression: ts.Expression): ts.Identifier | null {
	if (ts.isIdentifier(expression)) return expression;
	if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
		return rootIdentifier(expression.expression);
	}
	return null;
}

function callPropertyName(expression: ts.Expression): string | null {
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	if (ts.isElementAccessExpression(expression) && expression.argumentExpression
		&& ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text;
	return ts.isIdentifier(expression) ? expression.text : null;
}

function sourceImportBindings(file: ts.SourceFile): Map<string, ImportBinding> {
	const bindings = new Map<string, ImportBinding>();
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
			|| statement.importClause?.isTypeOnly) continue;
		const module = statement.moduleSpecifier.text;
		const clause = statement.importClause;
		if (!clause) continue;
		if (clause.name) bindings.set(clause.name.text, { module, imported: 'default' });
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
			bindings.set(clause.namedBindings.name.text, { module, imported: '*' });
		} else if (clause.namedBindings) {
			for (const element of clause.namedBindings.elements) {
				if (element.isTypeOnly) continue;
				bindings.set(element.name.text, {
					module,
					imported: element.propertyName?.text ?? element.name.text,
				});
			}
		}
	}
	return bindings;
}

function literalOwner(call: ts.CallExpression, argumentIndex: number): string | null {
	const argument = call.arguments[argumentIndex];
	if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
	for (const property of argument.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
			? property.name.text
			: null;
		if (name === 'owner' && ts.isStringLiteralLike(property.initializer)) return property.initializer.text;
	}
	return null;
}

export function inspectBrowserEntrySource(source: string, fileName: string, repositoryPath: string): string | null {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const bindings = sourceImportBindings(file);
	const collectAliases = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const root = rootIdentifier(node.initializer);
			const origin = root ? bindings.get(root.text) : undefined;
			if (origin) {
				const member = callPropertyName(node.initializer);
				bindings.set(node.name.text, {
					module: origin.module,
					imported: member && member !== root?.text ? member : origin.imported,
				});
			}
		}
		ts.forEachChild(node, collectAliases);
	};
	collectAliases(file);
	let sharedLaunchCount = 0;
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const root = rootIdentifier(node.expression);
			const binding = root ? bindings.get(root.text) : undefined;
			const property = callPropertyName(node.expression);
			if (binding?.module.endsWith('/scripts/browser-driver')
				&& (binding.imported === 'launchPuppeteerBrowser' || binding.imported === 'launchPlaywrightPersistentContext')) {
				const ownerIndex = binding.imported === 'launchPuppeteerBrowser' ? 1 : 3;
				const owner = literalOwner(node, ownerIndex);
				if (owner !== repositoryPath) {
					throw new Error(`${repositoryPath}: browser launch owner must be the exact importing source path`);
				}
				sharedLaunchCount += 1;
			} else if (binding && (
				(binding.module.includes('playwright') && (property === 'launch' || property === 'launchPersistentContext'
					|| binding.imported === 'launch' || binding.imported === 'launchPersistentContext'))
				|| (binding.module.includes('puppeteer') && (property === 'launch' || binding.imported === 'launch'))
			)) {
				throw new Error(`${repositoryPath}: direct browser launch bypasses scripts/browser-driver.ts`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	const importsSharedLaunch = [...bindings.values()].some((binding) => binding.module.endsWith('/scripts/browser-driver')
		&& (binding.imported === 'launchPuppeteerBrowser' || binding.imported === 'launchPlaywrightPersistentContext'));
	if (importsSharedLaunch && sharedLaunchCount === 0) {
		throw new Error(`${repositoryPath}: imported browser launch owner is never called`);
	}
	return sharedLaunchCount > 0 ? repositoryPath : null;
}

export function collectDefaultReleaseBrowserOwners(): string[] {
	const executableEntries = new Set<string>();
	const manifests: Array<{ path: string; roots: string[] }> = [
		{ path: 'apps/extension-halo/package.json', roots: ['test:browser-chromium'] },
		{ path: 'apps/extension-spectra/package.json', roots: ['test:chrome:dist', 'test:zip-smoke'] },
	];
	for (const { path: manifestPath, roots } of manifests) {
		const appDir = dirname(manifestPath);
		const manifest = JSON.parse(readFileSync(resolve(workspaceDir, manifestPath), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		const scripts = manifest.scripts ?? {};
		const expandTestPath = (value: string): string[] => {
			if (/^test\/.+\.(?:spec|test)\.ts$/u.test(value)) return [value];
			if (!/^test\/[A-Za-z0-9._/-]+$/u.test(value) || /\.[A-Za-z0-9]+$/u.test(value)) return [];
			const absolute = resolve(workspaceDir, appDir, value);
			if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return [];
			const files: string[] = [];
			const walk = (directory: string, prefix: string): void => {
				const entries = readdirSync(directory, { withFileTypes: true })
					.sort((left, right) => left.name.localeCompare(right.name));
				for (const entry of entries) {
					const path = `${prefix}/${entry.name}`;
					if (entry.isDirectory()) walk(resolve(directory, entry.name), path);
					else if (entry.isFile() && /\.(?:spec|test)\.ts$/u.test(entry.name)) files.push(path);
				}
			};
			walk(absolute, value);
			return files;
		};
		const visited = new Set<string>();
		const visitScript = (name: string): void => {
			if (visited.has(name)) return;
			visited.add(name);
			const command = scripts[name];
			if (!command) throw new Error(`${manifestPath} is missing default browser script ${name}`);
			const tokens = packageScriptTokens(command);
			const directTests = tokens.flatMap(expandTestPath);
			const invokesPlaywright = tokens.some((token) => /(?:^|[/\\])playwright$/u.test(token))
				&& tokens.includes('test');
			const invokesBunTest = tokens[0] === 'bun' && tokens[1] === 'test';
			if ((invokesPlaywright || invokesBunTest) && directTests.length === 0) {
				throw new Error(`${manifestPath} ${name}: default browser test closure is not statically enumerable`);
			}
			for (const token of tokens) {
				if (scripts[token]) visitScript(token);
				for (const testFile of expandTestPath(token)) executableEntries.add(`${appDir}/${testFile}`);
				if (/^(?:scripts\/).+\.ts$/u.test(token)) {
					const path = resolve(workspaceDir, appDir, token);
					if (!existsSync(path)) continue;
					executableEntries.add(`${appDir}/${token}`);
					for (const literal of stringLiterals(readFileSync(path, 'utf8'), path)) {
						for (const testFile of expandTestPath(literal)) executableEntries.add(`${appDir}/${testFile}`);
					}
				}
			}
		};
		for (const root of roots) visitScript(root);
	}
	const browserOwners: string[] = [];
	for (const path of executableEntries) {
		const absolute = resolve(workspaceDir, path);
		if (!existsSync(absolute)) throw new Error(`default release test is missing: ${path}`);
		const owner = inspectBrowserEntrySource(readFileSync(absolute, 'utf8'), absolute, path);
		if (owner) browserOwners.push(owner);
	}
	return browserOwners.sort();
}

export interface BrowserEvidenceCollectionContext {
	head: string;
	tree: string;
	run: string;
	attempt: number;
	requiredOwners: string[];
}

export type NormalizedBrowserLaunch = Omit<BrowserLaunchIdentity, 'run' | 'attempt' | 'executionSequence'>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseBrowserLaunchIdentity(value: unknown): BrowserLaunchIdentity {
	if (!isRecord(value) || !hasExactKeys(value, [
		'schemaVersion', 'owner', 'driver', 'head', 'tree', 'run', 'attempt', 'executionSequence',
		'platform', 'arch', 'browserVersion', 'executable', 'effectiveArgs', 'profile',
	])) throw new Error('browser launch evidence has an invalid top-level shape');
	if (value.schemaVersion !== 1 || typeof value.owner !== 'string'
		|| !['playwright', 'puppeteer-current', 'puppeteer-floor'].includes(String(value.driver))
		|| typeof value.head !== 'string' || !SHA_PATTERN.test(value.head)
		|| typeof value.tree !== 'string' || !SHA_PATTERN.test(value.tree)
		|| typeof value.run !== 'string' || !value.run || value.run.length > 128 || hasControlCharacters(value.run)
		|| !Number.isInteger(value.attempt) || Number(value.attempt) <= 0
		|| !Number.isInteger(value.executionSequence) || Number(value.executionSequence) <= 0
		|| typeof value.platform !== 'string' || !PLATFORM_PATTERN.test(value.platform)
		|| typeof value.arch !== 'string' || !ARCH_PATTERN.test(value.arch)
		|| typeof value.browserVersion !== 'string' || !value.browserVersion) {
		throw new Error('browser launch evidence has invalid identity fields');
	}
	safeOwner(value.owner);
	if (!isRecord(value.executable)) throw new Error('browser launch executable evidence is malformed');
	if (value.executable.status === 'observed') {
		if (!hasExactKeys(value.executable, ['status', 'basename', 'bytes', 'informationalSha256'])
			|| typeof value.executable.basename !== 'string' || !value.executable.basename
			|| value.executable.basename.includes('/') || value.executable.basename.includes('\\')
			|| !Number.isInteger(value.executable.bytes) || Number(value.executable.bytes) <= 0
			|| typeof value.executable.informationalSha256 !== 'string'
			|| !/^[a-f0-9]{64}$/u.test(value.executable.informationalSha256)) {
			throw new Error('browser launch observed executable evidence is malformed');
		}
	} else if (value.executable.status === 'unknown') {
		if (!hasExactKeys(value.executable, ['status', 'reason'])
			|| typeof value.executable.reason !== 'string' || !value.executable.reason) {
			throw new Error('browser launch unknown executable evidence is malformed');
		}
	} else throw new Error('browser launch executable evidence has an invalid status');
	if (Array.isArray(value.effectiveArgs)) {
		if (!value.effectiveArgs.every((argument) => typeof argument === 'string')
			|| value.effectiveArgs.some((argument) => argument === '--user-data-dir'
				|| (argument.startsWith('--user-data-dir=') && argument !== '--user-data-dir=<temporary-profile>'))) {
			throw new Error('browser launch effective arguments are malformed or expose a profile');
		}
	} else if (!isRecord(value.effectiveArgs)
		|| !hasExactKeys(value.effectiveArgs, ['status', 'reason'])
		|| value.effectiveArgs.status !== 'unknown'
		|| typeof value.effectiveArgs.reason !== 'string' || !value.effectiveArgs.reason) {
		throw new Error('browser launch effective arguments have an invalid unknown shape');
	}
	if (!isRecord(value.profile)
		|| !hasExactKeys(value.profile, ['kind', 'prefix', 'isolated', 'commandLine'])
		|| value.profile.kind !== 'temporary' || value.profile.isolated !== true
		|| typeof value.profile.prefix !== 'string' || !/^[a-z0-9._-]+$/iu.test(value.profile.prefix)
		|| !isRecord(value.profile.commandLine)) throw new Error('browser launch profile evidence is malformed');
	if (value.profile.commandLine.status === 'matched') {
		if (!hasExactKeys(value.profile.commandLine, ['status'])) {
			throw new Error('browser launch matched profile evidence is malformed');
		}
	} else if (value.profile.commandLine.status === 'unknown') {
		if (!hasExactKeys(value.profile.commandLine, ['status', 'reason'])
			|| typeof value.profile.commandLine.reason !== 'string' || !value.profile.commandLine.reason) {
			throw new Error('browser launch unknown profile evidence is malformed');
		}
	} else throw new Error('browser launch profile evidence has an invalid status');
	return value as unknown as BrowserLaunchIdentity;
}

export function normalizedBrowserLaunches(records: BrowserLaunchIdentity[]): NormalizedBrowserLaunch[] {
	return records.map(({ run: _run, attempt: _attempt, executionSequence: _sequence, ...record }) => record)
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function collectBrowserLaunchEvidence(
	directory: string,
	context: BrowserEvidenceCollectionContext,
): BrowserLaunchIdentity[] {
	if (!SHA_PATTERN.test(context.head) || !SHA_PATTERN.test(context.tree)
		|| !context.run || context.run.length > 128 || hasControlCharacters(context.run)
		|| !Number.isInteger(context.attempt) || context.attempt <= 0) {
		throw new Error('browser launch collector context is invalid');
	}
	const requiredOwners = [...new Set(context.requiredOwners.map(safeOwner))].sort();
	if (requiredOwners.length === 0) throw new Error('browser launch collector requires at least one owner');
	if (requiredOwners.length !== context.requiredOwners.length) {
		throw new Error('browser launch collector required owners contain duplicates');
	}
	const runIdentity = createHash('sha256').update(context.run).digest('hex').slice(0, 16);
	const prefix = `${EVIDENCE_PREFIX}.${context.head}.${runIdentity}.attempt-${context.attempt}.`;
	const records: BrowserLaunchIdentity[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.name.startsWith(prefix) || !entry.name.endsWith('.json')) continue;
		if (!entry.isFile()) throw new Error(`browser launch evidence is not a regular file: ${entry.name}`);
		const path = resolve(directory, entry.name);
		if (statSync(path).size > 64 * 1024) throw new Error(`browser launch evidence is oversized: ${entry.name}`);
		const record = parseBrowserLaunchIdentity(JSON.parse(readFileSync(path, 'utf8')));
		if (record.head !== context.head || record.tree !== context.tree || record.run !== context.run
			|| record.attempt !== context.attempt) throw new Error(`browser launch evidence identity mismatch: ${entry.name}`);
		if (record.executable.status !== 'observed' || !Array.isArray(record.effectiveArgs)
			|| record.profile.commandLine.status !== 'matched') {
			throw new Error(`formal browser launch evidence contains unknown execution identity: ${entry.name}`);
		}
		const fileOwner = record.owner.replaceAll('/', '__');
		const expectedName = `${prefix}${fileOwner}.${record.executionSequence}.json`;
		if (entry.name !== expectedName) throw new Error(`browser launch evidence filename mismatch: ${entry.name}`);
		records.push(record);
	}
	const actualOwners = [...new Set(records.map(({ owner }) => owner))].sort();
	if (JSON.stringify(actualOwners) !== JSON.stringify(requiredOwners)) {
		throw new Error(`browser launch owner coverage mismatch: required=${requiredOwners.join(',')} actual=${actualOwners.join(',')}`);
	}
	for (const owner of requiredOwners) {
		const sequences = records.filter((record) => record.owner === owner)
			.map((record) => record.executionSequence).sort((left, right) => left - right);
		if (sequences.some((sequence, index) => sequence !== index + 1)) {
			throw new Error(`browser launch physical sequence is incomplete for ${owner}`);
		}
	}
	return records.sort((left, right) => left.owner.localeCompare(right.owner)
		|| left.executionSequence - right.executionSequence);
}
