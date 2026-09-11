import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import './ci-product-scope.spec';
import './prune-turbo-cache.spec';
import {
	eolProblems,
	packageScriptProblems,
	parseEolEntries,
	parseGitBatchObjects,
	parseIndexEntries,
	portablePathProblems,
	processSourceProblems,
	textEncodingProblems,
} from './platform-contract.ts';

const crossPlatformWorkflow = readFileSync(
	new URL('../../.github/workflows/cross-platform.yml', import.meta.url),
	'utf8',
);
const turboConfig = readFileSync(new URL('../turbo.json', import.meta.url), 'utf8');
const GITHUB_EXPRESSION = '$' + '{{';
const SHELL_PARAMETER = '$' + '{';

describe('cross-platform path contract', () => {
	test('rejects Windows-reserved, ambiguous, decomposed, and case-colliding paths', () => {
		const problems = portablePathProblems([
			'docs/A.txt',
			'docs/a.txt',
			'docs/con.md',
			'docs/trailing.',
			'docs/e\u0301.md',
			'docs/name?.md',
			'docs/COM¹.log',
		]);
		expect(problems.some((problem) => problem.includes('case-fold collision'))).toBe(true);
		expect(problems.some((problem) => problem.includes('reserved device name'))).toBe(true);
		expect(problems.some((problem) => problem.includes('trailing dots or spaces'))).toBe(true);
		expect(problems.some((problem) => problem.includes('Unicode NFC'))).toBe(true);
		expect(problems.some((problem) => problem.includes('legal Windows path segment'))).toBe(true);
	});

	test('accepts normalized portable repository paths', () => {
		expect(portablePathProblems([
			'.github/workflows/cross-platform.yml',
			'nexus/apps/extension-spectra/src/index.ts',
			'nexus/docs/工程.md',
		])).toEqual([]);
	});
});

describe('Git byte and mode parsing', () => {
	test('parses NUL-delimited index records without shell quoting', () => {
		expect(parseIndexEntries(
			'100644 0123456789abcdef 0\tpath with space.txt\0' +
			'100755 fedcba9876543210 0\tnexus/scripts/check.ts\0',
		)).toEqual([
			{ mode: '100644', objectId: '0123456789abcdef', stage: 0, path: 'path with space.txt' },
			{ mode: '100755', objectId: 'fedcba9876543210', stage: 0, path: 'nexus/scripts/check.ts' },
		]);
	});

	test('rejects CRLF or incompletely attributed index text', () => {
		const entries = parseEolEntries(
			'i/crlf  w/crlf  attr/text=auto eol=lf\tbad.ts\0' +
			'i/lf    w/lf    attr/                  \tmissing.ts\0' +
			'i/-text w/-text attr/-text            \timage.png\0',
		);
		const problems = eolProblems(entries);
		expect(problems).toContain('bad.ts: Git index contains CRLF text');
		expect(problems).toContain('missing.ts: missing repository text=auto/text and eol=lf attributes');
		expect(problems.some((problem) => problem.startsWith('image.png:'))).toBe(false);
	});

	test('parses deleted worktree records and binary Git batch objects', () => {
		expect(parseEolEntries(
			'i/lf    w/      attr/text=auto eol=lf \tdeleted.ts\0',
		)).toEqual([{
			indexEol: 'lf',
			worktreeEol: null,
			attributes: 'text=auto eol=lf',
			path: 'deleted.ts',
		}]);
		const first = Buffer.from('line one\n');
		const second = Buffer.from([0, 1, 2, 10, 255]);
		const batch = Buffer.concat([
			Buffer.from(`0123 blob ${first.length}\n`),
			first,
			Buffer.from('\n4567 blob 5\n'),
			second,
			Buffer.from('\n'),
		]);
		const objects = parseGitBatchObjects(batch);
		expect(objects.get('0123')).toEqual({ type: 'blob', bytes: first });
		expect(objects.get('4567')).toEqual({ type: 'blob', bytes: second });
	});

	test('rejects implicit binary, BOM, NUL, and invalid UTF-8 text', () => {
		const entries = [
			{ indexEol: '-text', attributes: 'text=auto eol=lf', path: 'implicit.bin' },
			{ indexEol: 'lf', attributes: 'text=auto eol=lf', path: 'bom.txt' },
			{ indexEol: 'lf', attributes: 'text=auto eol=lf', path: 'nul.txt' },
			{ indexEol: 'lf', attributes: 'text=auto eol=lf', path: 'invalid.txt' },
			{ indexEol: '-text', attributes: '-text eol=lf', path: 'explicit.bin' },
		];
		expect(eolProblems(entries)).toContain(
			'implicit.bin: binary content requires an explicit -text attribute',
		);
		const bytes = new Map([
			['bom.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x61])],
			['nul.txt', Buffer.from([0x61, 0x00])],
			['invalid.txt', Buffer.from([0xff])],
			['implicit.bin', Buffer.from([0xff])],
			['explicit.bin', Buffer.from([0xff])],
		]);
		expect(textEncodingProblems(entries, (path) => bytes.get(path))).toEqual([
			'implicit.bin: text is not valid UTF-8',
			'bom.txt: UTF-8 BOM is prohibited',
			'nul.txt: NUL byte requires an explicit -text attribute',
			'invalid.txt: text is not valid UTF-8',
		]);
	});
});

describe('portable automation contract', () => {
	test('rejects host shells, semicolon sequencing, and Windows path syntax', () => {
		const problems = packageScriptProblems('package.json', {
			badShell: 'powershell -Command Copy-Item public dist',
			badSequence: 'bun run build ; bun test',
			badPath: 'bun scripts\\check.ts',
			good: 'bun run build && bun test test/unit.spec.ts',
		});
		expect(problems).toHaveLength(3);
		expect(problems.every((problem) => !problem.includes('#good:'))).toBe(true);
	});

	test('rejects command-string and host-PATH child processes', () => {
		const commandString = [
			"import { execSync } from 'node:child_process';",
			"execSync('git status');",
		].join('\n');
		const shellProcess = [
			"import { spawnSync } from 'node:child_process';",
			"spawnSync('bun', ['test'], { shell: true });",
		].join('\n');
		expect(processSourceProblems('command.ts', commandString)).toHaveLength(1);
		expect(processSourceProblems('shell.ts', shellProcess)).toHaveLength(2);
		expect(processSourceProblems(
			'portable.ts',
			"import { execFileSync } from 'node:child_process';\nexecFileSync(process.execPath, ['test']);",
		)).toEqual([]);
	});

	test('requires bounded retry semantics for recursive cleanup', () => {
		expect(processSourceProblems(
			'fragile.ts',
			"rmSync(directory, { recursive: true, force: true });",
		)).toEqual([
			'fragile.ts: recursive cleanup requires bounded maxRetries and retryDelay',
		]);
		expect(processSourceProblems(
			'portable.ts',
			'\\nrmSync(directory, {\\n' +
			'\\trecursive: true,\\n\\tforce: true,\\n\\tmaxRetries: 5,\\n\\tretryDelay: 100,\\n});',
		)).toEqual([]);
	});

	test('caches the real Turborepo store with revision snapshots and bounded pruning', () => {
		expect(crossPlatformWorkflow).not.toContain('node_modules/.cache/turbo');
		expect(crossPlatformWorkflow.match(/path: nexus\/\.turbo\/cache/gu)).toHaveLength(2);
		expect(crossPlatformWorkflow).toContain(
			`key: turbo-quality-${GITHUB_EXPRESSION} runner.os }}-${GITHUB_EXPRESSION} hashFiles('nexus/bun.lock') }}-${GITHUB_EXPRESSION} github.sha }}`,
		);
		expect(crossPlatformWorkflow).toContain(
			`key: turbo-build-${GITHUB_EXPRESSION} runner.os }}-${GITHUB_EXPRESSION} hashFiles('nexus/bun.lock') }}-${GITHUB_EXPRESSION} github.sha }}`,
		);
		expect(crossPlatformWorkflow).toContain('node nexus/scripts/prune-turbo-cache.mjs nexus/.turbo/cache');
		expect(crossPlatformWorkflow.match(/name: Bound Turbo cache snapshot/gu)).toHaveLength(2);
	});

	test('uses one fail-closed scope job and rejects ambiguous merge bases', () => {
		expect(crossPlatformWorkflow).toContain('name: product scope (ubuntu)');
		expect(crossPlatformWorkflow).toContain('fetch-depth: 0');
		expect(crossPlatformWorkflow).toContain(`BASE_SHA: ${GITHUB_EXPRESSION} github.event.pull_request.base.sha }}`);
		expect(crossPlatformWorkflow).toContain(`HEAD_SHA: ${GITHUB_EXPRESSION} github.event.pull_request.head.sha }}`);
		expect(crossPlatformWorkflow).toContain('git merge-base --all "$BASE_SHA" "$HEAD_SHA"');
		expect(crossPlatformWorkflow).toContain(`if [[ "${SHELL_PARAMETER}#merge_bases[@]}" -ne 1 ]]`);
		expect(crossPlatformWorkflow).toContain(`git diff --no-renames --name-only -z "${SHELL_PARAMETER}merge_bases[0]}" "$HEAD_SHA"`);
		expect(crossPlatformWorkflow).toContain('node nexus/scripts/ci-product-scope.mjs');
		expect(crossPlatformWorkflow).not.toContain('HEAD^ HEAD');
		expect(crossPlatformWorkflow).not.toContain('done < <(');
	});

	test('hashes HALO registry generation into every production build task', () => {
		expect(turboConfig).toContain('"$TURBO_ROOT$/scripts/generate-tool-registry.ts"');
		expect(turboConfig).toContain('"$TURBO_ROOT$/scripts/registry-gen/**"');
	});

	test('gates the whole build matrix from scope outputs and routes product-specific builds', () => {
		expect(crossPlatformWorkflow).toContain('needs: scope');
		expect(crossPlatformWorkflow).toContain(
			"if: needs.scope.outputs.spectra == 'true' || needs.scope.outputs.halo == 'true'",
		);
		expect(crossPlatformWorkflow).toContain('run: bun run build');
		expect(crossPlatformWorkflow).toContain('run: bun run --cwd nexus build:spectra');
		expect(crossPlatformWorkflow).toContain('run: bun run --cwd nexus build:halo');
		expect(crossPlatformWorkflow).not.toContain('run: bun --cwd nexus run ');
		expect(crossPlatformWorkflow).toContain("if: needs.scope.outputs.spectra == 'true'");
		expect(crossPlatformWorkflow).toContain("if: needs.scope.outputs.halo == 'true'");
	});
});
