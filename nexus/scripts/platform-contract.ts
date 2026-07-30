import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const WINDOWS_RESERVED_BASENAME = /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])$/iu;
const WINDOWS_INVALID_SEGMENT = /[<>:"\\|?*]/u;
const HOST_SHELL = /(?:^|[\s;&|()])(?:bash|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|zsh)(?=$|[\s;&|()])/iu;
const CHILD_PROCESS_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/gu;
const CHILD_PROCESS_REQUIRE = /const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]node:child_process['"]\s*\)/gu;
const ALLOWED_CHILD_PROCESS_APIS = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync']);

function compareText(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function normalizeEol(value) {
	return value.replace(/\r\n?/gu, '\n');
}

export function parseNulRecords(value) {
	return value.split('\0').filter(Boolean);
}

export function parseIndexEntries(value) {
	return parseNulRecords(value).map((record) => {
		const match = /^(100644|100755|120000|160000) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/u.exec(record);
		if (!match) throw new Error(`Unrecognized git index record: ${JSON.stringify(record)}`);
		return {
			mode: match[1],
			objectId: match[2],
			stage: Number(match[3]),
			path: match[4],
		};
	});
}

export function parseEolEntries(value) {
	return parseNulRecords(value).map((record) => {
		const match = /^i\/(\S+)\s+w\/(\S*)\s+attr\/(.*?)\t([\s\S]+)$/u.exec(record);
		if (!match) throw new Error(`Unrecognized git EOL record: ${JSON.stringify(record)}`);
		return {
			indexEol: match[1],
			worktreeEol: match[2] || null,
			attributes: match[3].trim(),
			path: match[4],
		};
	});
}

export function parseGitBatchObjects(value) {
	const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
	const objects = new Map();
	let offset = 0;
	while (offset < bytes.length) {
		const headerEnd = bytes.indexOf(0x0a, offset);
		if (headerEnd < 0) throw new Error('Git batch object header is missing its newline');
		const header = bytes.subarray(offset, headerEnd).toString('utf8');
		const match = /^([0-9a-f]+) ([a-z]+) ([0-9]+)$/u.exec(header);
		if (!match) throw new Error(`Unrecognized git batch object: ${JSON.stringify(header)}`);
		const size = Number.parseInt(match[3], 10);
		const contentStart = headerEnd + 1;
		const contentEnd = contentStart + size;
		if (contentEnd >= bytes.length || bytes[contentEnd] !== 0x0a) {
			throw new Error(`Git batch object ${match[1]} has a truncated payload`);
		}
		objects.set(match[1], {
			type: match[2],
			bytes: bytes.subarray(contentStart, contentEnd),
		});
		offset = contentEnd + 1;
	}
	return objects;
}

export function portablePathProblems(paths) {
	const problems = [];
	const caseFolded = new Map();

	for (const path of [...paths].sort(compareText)) {
		if (path.includes('\\')) problems.push(`${path}: Git paths must use forward slashes`);
		if (path !== path.normalize('NFC')) problems.push(`${path}: path must use Unicode NFC`);

		const normalized = path.replaceAll('\\', '/').normalize('NFC');
		const segments = normalized.split('/');
		for (const segment of segments) {
			if (!segment || segment === '.' || segment === '..') {
				problems.push(`${path}: path contains an empty or relative segment`);
				continue;
			}
			if (
				WINDOWS_INVALID_SEGMENT.test(segment)
				|| [...segment].some((character) => character.codePointAt(0) <= 0x1f)
			) {
				problems.push(`${path}: ${JSON.stringify(segment)} is not a legal Windows path segment`);
			}
			if (/[. ]$/u.test(segment)) {
				problems.push(`${path}: Windows strips trailing dots or spaces from ${JSON.stringify(segment)}`);
			}
			const stem = segment.split('.', 1)[0];
			if (WINDOWS_RESERVED_BASENAME.test(stem)) {
				problems.push(`${path}: ${JSON.stringify(segment)} uses a Windows reserved device name`);
			}
		}

		const folded = normalized.toLowerCase();
		const previous = caseFolded.get(folded);
		if (previous && previous !== path) {
			problems.push(`${path}: case-fold collision with ${previous}`);
		} else {
			caseFolded.set(folded, path);
		}
	}

	return problems;
}

export function indexModeProblems(entries, readBytes) {
	const problems = [];
	for (const entry of entries) {
		if (entry.stage !== 0) {
			problems.push(`${entry.path}: unresolved Git index stage ${entry.stage}`);
			continue;
		}
		if (entry.mode === '120000') {
			problems.push(`${entry.path}: symlinks are prohibited because Windows checkout semantics differ`);
			continue;
		}
		if (entry.mode === '160000') {
			problems.push(`${entry.path}: Git submodules require an explicit cross-platform ownership decision`);
			continue;
		}

		let startsWithShebang = false;
		try {
			startsWithShebang = readBytes(entry.path)
				.subarray(0, 2)
				.equals(Buffer.from('#!'));
		} catch (error) {
			problems.push(`${entry.path}: cannot inspect indexed file: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (startsWithShebang && entry.mode !== '100755') {
			problems.push(`${entry.path}: shebang scripts must have Git mode 100755`);
		}
		if (!startsWithShebang && entry.mode === '100755') {
			problems.push(`${entry.path}: executable Git mode requires a shebang`);
		}
	}
	return problems;
}

export function eolProblems(entries) {
	const problems = [];
	for (const entry of entries) {
		if (entry.indexEol === 'crlf' || entry.indexEol === 'mixed') {
			problems.push(`${entry.path}: Git index contains ${entry.indexEol.toUpperCase()} text`);
		}
		if (entry.indexEol === '-text' && !entry.attributes.includes('-text')) {
			problems.push(`${entry.path}: binary content requires an explicit -text attribute`);
			continue;
		}
		if (entry.attributes.includes('-text')) continue;
		if (!/\b(?:text|text=auto)\b/u.test(entry.attributes) || !/\beol=lf\b/u.test(entry.attributes)) {
			problems.push(`${entry.path}: missing repository text=auto/text and eol=lf attributes`);
		}
	}
	return problems;
}

export function textEncodingProblems(entries, readBytes) {
	const problems = [];
	const decoder = new TextDecoder('utf-8', { fatal: true });
	for (const entry of entries) {
		if (entry.attributes.includes('-text')) continue;
		const bytes = readBytes(entry.path);
		if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
			problems.push(`${entry.path}: UTF-8 BOM is prohibited`);
			continue;
		}
		if (bytes.includes(0)) {
			problems.push(`${entry.path}: NUL byte requires an explicit -text attribute`);
			continue;
		}
		try {
			decoder.decode(bytes);
		} catch {
			problems.push(`${entry.path}: text is not valid UTF-8`);
		}
	}
	return problems;
}

export function packageScriptProblems(manifestPath, scripts) {
	const problems = [];
	for (const [name, value] of Object.entries(scripts ?? {})) {
		if (typeof value !== 'string') {
			problems.push(`${manifestPath}#${name}: package script must be a string`);
			continue;
		}
		if (HOST_SHELL.test(value) || /\/bin\/(?:ba)?sh\b/iu.test(value)) {
			problems.push(`${manifestPath}#${name}: host-specific shell executable is prohibited`);
		}
		if (value.includes('\\')) {
			problems.push(`${manifestPath}#${name}: repository command paths must use forward slashes`);
		}
		if (value.includes(';')) {
			problems.push(`${manifestPath}#${name}: use failure-propagating Bun scripts instead of semicolon chaining`);
		}
		if (/%[A-Za-z_][A-Za-z0-9_]*%/u.test(value)) {
			problems.push(`${manifestPath}#${name}: cmd.exe environment expansion is prohibited`);
		}
	}
	return problems;
}

function importedChildProcessApis(source) {
	const names = [];
	for (const pattern of [CHILD_PROCESS_IMPORT, CHILD_PROCESS_REQUIRE]) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) {
			for (const specifier of match[1].split(',')) {
				const imported = specifier.trim().split(/\s+as\s+/u)[0]?.trim();
				if (imported) names.push(imported);
			}
		}
	}
	return names;
}

export function processSourceProblems(path, source) {
	const problems = [];
	for (const api of importedChildProcessApis(source)) {
		if (!ALLOWED_CHILD_PROCESS_APIS.has(api)) {
			problems.push(`${path}: node:child_process ${api} is not an argument-array process API`);
		}
	}
	if (/\bshell\s*:\s*true\b/gu.test(source)) {
		problems.push(`${path}: enabling a subprocess shell is prohibited`);
	}
	if (
		/import\s+\*\s+as\s+\w+\s+from\s+['"]node:child_process['"]/gu.test(source)
		|| /require\(\s*['"]node:child_process['"]\s*\)\.exec(?:Sync)?\s*\(/gu.test(source)
	) {
		problems.push(`${path}: namespace or direct command-string child processes are prohibited`);
	}
	if (/\b(?:execFile|execFileSync|spawn|spawnSync|run|runOptional)\s*\(\s*['"]bunx?['"]/gu.test(source)) {
		problems.push(`${path}: launch the pinned Bun with process.execPath instead of a PATH lookup`);
	}
	if (/\bmkdtemp(?:Sync)?\s*\(/gu.test(source) && !/\btmpdir\s*\(/gu.test(source)) {
		problems.push(`${path}: temporary directories must derive from os.tmpdir()`);
	}
	if (/['"`]\/tmp(?:\/|['"`])/gu.test(source)) {
		problems.push(`${path}: literal Unix temporary paths are prohibited`);
	}
	for (const match of source.matchAll(/(?:\bfs\.)?rm(?:Sync)?\s*\([\s\S]{0,500}?\brecursive\s*:\s*true[\s\S]{0,500}?\}\s*\)/gu)) {
		if (!/\bmaxRetries\s*:\s*[1-9]\d*\b/u.test(match[0]) || !/\bretryDelay\s*:\s*[1-9]\d*\b/u.test(match[0])) {
			problems.push(`${path}: recursive cleanup requires bounded maxRetries and retryDelay`);
		}
	}
	return problems;
}

export function configProblems(repositoryRoot) {
	const problems = [];
	const attributes = normalizeEol(readFileSync(resolve(repositoryRoot, '.gitattributes'), 'utf8'));
	const editorConfig = normalizeEol(readFileSync(resolve(repositoryRoot, '.editorconfig'), 'utf8'));
	const lefthook = normalizeEol(readFileSync(resolve(repositoryRoot, 'lefthook.yml'), 'utf8'));
	const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
	const workspaceManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'nexus/package.json'), 'utf8'));
	const workflow = normalizeEol(
		readFileSync(resolve(repositoryRoot, '.github/workflows/cross-platform.yml'), 'utf8'),
	);

	for (const required of [
		'* text=auto eol=lf',
		'*.png -text',
		'remote-site/vendor/peerjs.min.js -text',
	]) {
		if (!attributes.split('\n').includes(required)) {
			problems.push(`.gitattributes: missing ${JSON.stringify(required)}`);
		}
	}
	for (const required of [
		'root = true',
		'charset = utf-8',
		'end_of_line = lf',
		'insert_final_newline = true',
	]) {
		if (!editorConfig.split('\n').includes(required)) {
			problems.push(`.editorconfig: missing ${JSON.stringify(required)}`);
		}
	}
	for (const required of [
		'ubuntu-latest',
		'windows-latest',
		'run: bun run check:platform',
		'bun run docs:check',
		'bun run verify:q',
		'bun run hooks:test',
		'bun --cwd nexus test:spectra',
		'bun --cwd nexus test:halo',
		'bun run typecheck',
		'bun run lint',
		'bun run build',
	]) {
		if (!workflow.includes(required)) {
			problems.push(`cross-platform.yml: missing ${JSON.stringify(required)}`);
		}
	}
	if (rootManifest.scripts?.['check:platform'] !== 'bun --cwd nexus check:platform') {
		problems.push('package.json: check:platform must proxy to the workspace gate');
	}
	if (
		workspaceManifest.scripts?.['check:platform']
		!== 'bun test scripts/platform-contract.test.ts && bun scripts/check-platform-contract.ts'
	) {
		problems.push('nexus/package.json: check:platform must run its tests before the repository scan');
	}
	if (!lefthook.includes('platform-contract:') || !lefthook.includes('run: bun run check:platform')) {
		problems.push('lefthook.yml: pre-push must run the platform contract');
	}
	return problems;
}

export function isFirstPartyProcessSource(path) {
	if (!/\.(?:cjs|js|mjs|ts)$/u.test(path)) return false;
	if (path === 'nexus/scripts/platform-contract.test.ts') return false;
	return path.startsWith('nexus/scripts/')
		|| /^nexus\/apps\/[^/]+\/build\.ts$/u.test(path)
		|| /^nexus\/apps\/[^/]+\/scripts\//u.test(path)
		|| /^nexus\/apps\/[^/]+\/test\//u.test(path);
}

export function readPackageScripts(paths, readText) {
	return paths
		.filter((path) => basename(path) === 'package.json')
		.map((path) => {
			const manifest = JSON.parse(readText(path));
			return { path, scripts: manifest.scripts };
		});
}
