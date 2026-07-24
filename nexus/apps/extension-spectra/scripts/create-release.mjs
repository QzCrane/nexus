import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProductionArtifacts } from './check-production-artifacts.mjs';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = resolve(projectDir, 'dist');
const releaseDir = resolve(projectDir, 'release');
const pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8'));

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

function listFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Release symlinks are forbidden: ${relative(distDir, path)}`);
		if (entry.isDirectory()) return listFiles(path);
		if (!entry.isFile()) throw new Error(`Unsupported release file type: ${relative(distDir, path)}`);
		return [path];
	}).sort((left, right) => {
		const leftName = relative(distDir, left).replaceAll('\\', '/');
		const rightName = relative(distDir, right).replaceAll('\\', '/');
		return leftName === rightName ? 0 : leftName < rightName ? -1 : 1;
	});
}

export function createStoredArchive(entries) {
	if (!Array.isArray(entries) || entries.length === 0 || entries.length > 0xffff) {
		throw new Error('ZIP entry count must be between 1 and 65535');
	}
	for (const entry of entries) {
		if (!entry || typeof entry.name !== 'string' || !Buffer.isBuffer(entry.data)) {
			throw new Error('ZIP entries require a string name and Buffer data');
		}
	}
	const orderedEntries = [...entries].sort((left, right) => {
		if (left.name === right.name) return 0;
		return left.name < right.name ? -1 : 1;
	});
	for (let index = 1; index < orderedEntries.length; index += 1) {
		if (orderedEntries[index - 1]?.name === orderedEntries[index]?.name) {
			throw new Error(`Duplicate ZIP entry: ${orderedEntries[index]?.name}`);
		}
	}
	const localParts = [];
	const centralParts = [];
	let offset = 0;
	for (const { name, data } of orderedEntries) {
		const nameBytes = Buffer.from(name, 'utf8');
		if (nameBytes.length === 0 || nameBytes.length > 0xffff) throw new Error(`Invalid ZIP entry name length: ${name}`);
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

function createArchive(files) {
	return createStoredArchive(files.map((file) => ({
		name: relative(distDir, file).replaceAll('\\', '/'),
		data: readFileSync(file),
	})));
}

export function createRelease({ stage = true } = {}) {
	if (!stage) throw new Error('Direct final release writes are disabled; validate and promote a staged ZIP instead');
	if (Bun.version !== '1.3.14') throw new Error(`Release staging requires Bun 1.3.14, found ${Bun.version}`);
	if (!existsSync(resolve(distDir, 'manifest.json'))) {
		throw new Error('Production dist is missing; run bun run build:prod first');
	}
	const files = listFiles(distDir);
	const manifest = JSON.parse(readFileSync(resolve(distDir, 'manifest.json'), 'utf8'));
	if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
		throw new Error(`Release manifest must be MV3 version ${pkg.version}`);
	}
	const popup = readFileSync(resolve(distDir, 'popup.html'), 'utf8');
	if (!popup.includes(`v${pkg.version} • Prod`)) {
		throw new Error('Release dist is not a verified production build; run bun run build:prod first');
	}
	checkProductionArtifacts({ distDir });

	const first = createArchive(files);
	const second = createArchive(files);
	if (!first.equals(second)) throw new Error('ZIP generation is not deterministic');

	const outputDir = resolve(releaseDir, '.staging');
	const archivePath = resolve(outputDir, `spectra-v${pkg.version}.zip`);
	const checksumPath = `${archivePath}.sha256`;
	rmSync(outputDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
	mkdirSync(outputDir, { recursive: true });
	rmSync(archivePath, { force: true });
	rmSync(checksumPath, { force: true });
	writeFileSync(archivePath, first);
	const digest = createHash('sha256').update(first).digest('hex');
	writeFileSync(checksumPath, `${digest}  ${archivePath.split(/[\\/]/).at(-1)}\n`);
	console.log(`✓ Staged ${relative(projectDir, archivePath)} (${(statSync(archivePath).size / 1024).toFixed(1)}KiB)`);
	console.log(`✓ SHA-256 ${digest}`);
	return { archivePath, checksumPath, digest };
}

function printHelp() {
	console.log('Usage: bun scripts/create-release.mjs --stage');
	console.log('  Writes release/.staging; smoke-release is the only final promotion path.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		printHelp();
	} else {
		const unknown = args.filter((arg) => arg !== '--stage');
		if (unknown.length) throw new Error(`Unknown create-release option: ${unknown.join(', ')}`);
		if (!args.includes('--stage')) throw new Error('create-release requires --stage');
		createRelease({ stage: true });
	}
}
