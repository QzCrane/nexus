import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_VERSION } from './toolchain-versions.ts';

export const EXPECTED_BUN_VERSION = BUN_VERSION;

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = resolve(workspaceDir, 'apps/extension-halo');
const distDir = resolve(extensionDir, 'dist');
const stagingDir = resolve(extensionDir, 'release/.staging');
const packageJson = JSON.parse(readFileSync(resolve(extensionDir, 'package.json'), 'utf8'));
const packageVersion = packageJson.version;
const sourceManifestPath = resolve(extensionDir, 'public/manifest.json');
const builtManifestPath = resolve(distDir, 'manifest.json');
const stagedArchive = resolve(stagingDir, `halo-v${packageVersion}.zip`);

function readVersion(path) {
	return JSON.parse(readFileSync(path, 'utf8')).version;
}

export function assertReleaseVersionParity(
	packageCandidate,
	sourceManifestCandidate,
	builtManifestCandidate,
) {
	if (typeof packageCandidate !== 'string' || !/^\d+\.\d+\.\d+$/.test(packageCandidate)) {
		throw new Error(`HALO package version must be SemVer x.y.z, found ${String(packageCandidate)}`);
	}
	if (sourceManifestCandidate !== packageCandidate) {
		throw new Error(
			`HALO version drift: package ${packageCandidate}, source manifest ${String(sourceManifestCandidate)}`,
		);
	}
	if (
		builtManifestCandidate !== undefined &&
		builtManifestCandidate !== packageCandidate
	) {
		throw new Error(
			`HALO version drift: package ${packageCandidate}, built manifest ${String(builtManifestCandidate)}`,
		);
	}
}

function assertSourceVersionParity() {
	assertReleaseVersionParity(packageVersion, readVersion(sourceManifestPath));
}

const FORBIDDEN_RELEASE_ENTRY = [
	/(^|\/)(?:\.git|node_modules|src|test|tests|docs|store-listings)(?:\/|$)/i,
	/\.(?:map|md|ts|tsx|zip|sha256|log|tsbuildinfo)$/i,
];

export function assertReleaseEntryPaths(entryPaths) {
	if (!entryPaths.includes('manifest.json')) {
		throw new Error('HALO release must contain manifest.json at the archive root');
	}
	for (const entryPath of entryPaths) {
		if (entryPath.startsWith('/') || entryPath.includes('\\') || entryPath.includes('../')) {
			throw new Error(`Unsafe HALO release path: ${entryPath}`);
		}
		if (FORBIDDEN_RELEASE_ENTRY.some((pattern) => pattern.test(entryPath))) {
			throw new Error(`Forbidden HALO release entry: ${entryPath}`);
		}
	}
}

// Deterministic ZIP implementation (STORED, no compression) shared with the
// SPECTRA create-release staging tool. HALO has no separate staging script, so
// the release driver produces the candidate archive inline.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function listDistFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Release symlinks are forbidden: ${relative(distDir, path)}`);
		if (entry.isDirectory()) return listDistFiles(path);
		if (!entry.isFile()) throw new Error(`Unsupported release file type: ${relative(distDir, path)}`);
		return [path];
	}).sort((left, right) => {
		const leftName = relative(distDir, left).replaceAll('\\', '/');
		const rightName = relative(distDir, right).replaceAll('\\', '/');
		return leftName === rightName ? 0 : leftName < rightName ? -1 : 1;
	});
}

function createStoredArchive(entries) {
	if (!Array.isArray(entries) || entries.length === 0 || entries.length > 0xffff) {
		throw new Error('ZIP entry count must be between 1 and 65535');
	}
	const orderedEntries = [...entries].sort((left, right) => {
		if (left.name === right.name) return 0;
		return left.name < right.name ? -1 : 1;
	});
	const localParts = [];
	const centralParts = [];
	let offset = 0;
	for (const { name, data } of orderedEntries) {
		const nameBytes = Buffer.from(name, 'utf8');
		if (nameBytes.length === 0 || nameBytes.length > 0xffff) {
			throw new Error(`Invalid ZIP entry name length: ${name}`);
		}
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(33, 12); // 1980-01-01, deterministic DOS date
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28);
		localParts.push(local, nameBytes, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(0x0314, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(33, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centralParts.push(central, nameBytes);
		offset += local.length + nameBytes.length + data.length;
	}

	const centralDirectory = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(orderedEntries.length, 8);
	end.writeUInt16LE(orderedEntries.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...localParts, centralDirectory, end]);
}

function createStagingZip() {
	if (Bun.version !== EXPECTED_BUN_VERSION) {
		throw new Error(`HALO staging requires Bun ${EXPECTED_BUN_VERSION}, found ${Bun.version}`);
	}
	if (!existsSync(builtManifestPath)) {
		throw new Error('Production dist is missing; run bun run --cwd apps/extension-halo build:prod first');
	}
	assertReleaseVersionParity(
		packageVersion,
		readVersion(sourceManifestPath),
		readVersion(builtManifestPath),
	);
	const files = listDistFiles(distDir);
	const entries = files.map((file) => ({
		name: relative(distDir, file).replaceAll('\\', '/'),
		data: readFileSync(file),
	}));
	assertReleaseEntryPaths(entries.map(({ name }) => name));
	const first = createStoredArchive(entries);
	const second = createStoredArchive(entries);
	if (!first.equals(second)) throw new Error('ZIP generation is not deterministic');

	rmSync(stagingDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
	mkdirSync(stagingDir, { recursive: true });
	writeFileSync(stagedArchive, first);
	const digest = createHash('sha256').update(first).digest('hex');
	writeFileSync(`${stagedArchive}.sha256`, `${digest}  ${stagedArchive.split(/[\\/]/).at(-1)}\n`);
	console.log(`✓ Staged ${relative(extensionDir, stagedArchive)} (${(statSync(stagedArchive).size / 1024).toFixed(1)}KiB)`);
	console.log(`✓ SHA-256 ${digest}`);
	return { archivePath: stagedArchive, digest };
}

export const RELEASE_STEPS = Object.freeze([
	{ label: 'version parity', fn: assertSourceVersionParity },
	{ label: 'architecture verify', args: ['run', 'verify:v'] },
	{ label: 'documentation architecture', args: ['run', 'docs:check'] },
	{ label: 'platform contract', args: ['run', 'check:platform'] },
	{ label: 'repository governance contracts', args: ['run', 'check:governance'] },
	{ label: 'public projection contract', args: ['run', 'check:public-projections'] },
	{ label: 'frozen dependency install', args: ['install', '--frozen-lockfile'] },
	{ label: 'toolchain verify', args: ['run', 'check:toolchain'] },
	{ label: 'Biome lint', args: ['run', 'lint'] },
	{ label: 'workspace dependency build', args: ['run', 'build:halo-deps'] },
	{ label: 'TypeScript check', args: ['run', 'typecheck:halo'] },
	{ label: 'unit tests', args: ['run', 'test:halo'] },
	{ label: 'production build', args: ['run', '--cwd', 'apps/extension-halo', 'build:prod'] },
	{ label: 'production Chromium contracts', args: ['run', '--cwd', 'apps/extension-halo', 'test:browser-chromium'] },
	{ label: 'dependency audit', args: ['run', 'audit:dependencies'] },
	{ label: 'staging ZIP', fn: createStagingZip },
]);

export function assertReleaseRuntime(version = Bun.version) {
	if (version !== EXPECTED_BUN_VERSION) {
		throw new Error(`HALO release requires Bun ${EXPECTED_BUN_VERSION}, found ${version}`);
	}
}

function formatCommand(args) {
	return [process.execPath, ...args].map((part) => part.includes(' ') ? JSON.stringify(part) : part).join(' ');
}

function formatStep(step) {
	if (step.args) return formatCommand(step.args);
	if (step.fn) return `(inline) ${step.fn.name || 'anonymous'}`;
	return '';
}

function releaseEnvironment() {
	const executableDirectory = dirname(process.execPath);
	return {
		...process.env,
		PATH: `${executableDirectory}${delimiter}${process.env.PATH ?? ''}`,
	};
}

export function runRelease({
	spawnProcess = spawnSync,
	runtimeVersion = Bun.version,
} = {}) {
	assertReleaseRuntime(runtimeVersion);
	// Never let an archive from an earlier failed attempt become the input to
	// this run.
	rmSync(stagingDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
	for (const [index, step] of RELEASE_STEPS.entries()) {
		console.log(`\n[${index + 1}/${RELEASE_STEPS.length}] ${step.label}`);
		if (step.fn) {
			step.fn();
		} else {
			const result = spawnProcess(process.execPath, step.args, {
				cwd: workspaceDir,
				env: releaseEnvironment(),
				stdio: 'inherit',
				shell: false,
			});
			if (result.error) throw result.error;
			if (result.status !== 0) {
				const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`;
				throw new Error(`HALO release stopped at ${step.label}: ${reason}`);
			}
		}
	}
	console.log('\n✓ HALO local release evidence completed and the candidate was staged');
}

function printPlan() {
	assertReleaseRuntime();
	console.log(`HALO release runtime: Bun ${Bun.version}`);
	for (const [index, step] of RELEASE_STEPS.entries()) {
		console.log(`${index + 1}. ${step.label}: ${formatStep(step)}`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length === 0) runRelease();
	else if (args.length === 1 && (args[0] === '--list' || args[0] === '--help' || args[0] === '-h')) printPlan();
	else throw new Error(`Unknown release-halo option: ${args.join(', ')}`);
}
