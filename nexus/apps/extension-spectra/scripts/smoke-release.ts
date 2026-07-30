import { spawnSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	computeReleaseSourceDigest,
	RELEASE_RECEIPT_CAPABILITY_ENV,
	RELEASE_RECEIPT_PATH_ENV,
	RELEASE_RECEIPT_TTL_MS,
	RELEASE_RECEIPT_VERSION,
	RELEASE_REQUIRED_GATE_LABELS,
	RELEASE_SOURCE_DIGEST_ENV,
	sha256File,
} from '../../../scripts/release-spectra.ts';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceDir = resolve(projectDir, '../..');
const releaseDir = resolve(projectDir, 'release');
const pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8'));
const archiveName = `spectra-v${pkg.version}.zip`;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2_048;
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;

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

function findEndOfCentralDirectory(archive) {
	const minimum = Math.max(0, archive.length - 65_557);
	for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
		if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
	}
	throw new Error('ZIP end-of-central-directory record is missing');
}

function assertSafeEntryName(name) {
	if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/u.test(name)) {
		throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(name)}`);
	}
	const segments = name.split('/');
	for (const segment of segments) {
		if (!segment || segment === '.' || segment === '..' || segment.includes(':') || /[. ]$/u.test(segment)) {
			throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(name)}`);
		}
		const device = segment.split('.')[0]?.toUpperCase();
		if (device && /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(device)) {
			throw new Error(`Unsafe Windows device path in ZIP: ${JSON.stringify(name)}`);
		}
	}
}

export function extractStoredZip(archivePath, destination) {
	if (statSync(archivePath).size > MAX_ARCHIVE_BYTES) throw new Error('ZIP exceeds the release smoke size limit');
	const archive = readFileSync(archivePath);
	const endOffset = findEndOfCentralDirectory(archive);
	const diskNumber = archive.readUInt16LE(endOffset + 4);
	const centralDisk = archive.readUInt16LE(endOffset + 6);
	const diskEntries = archive.readUInt16LE(endOffset + 8);
	const entryCount = archive.readUInt16LE(endOffset + 10);
	const centralSize = archive.readUInt32LE(endOffset + 12);
	const centralOffset = archive.readUInt32LE(endOffset + 16);
	const commentLength = archive.readUInt16LE(endOffset + 20);
	if (endOffset + 22 + commentLength !== archive.length) throw new Error('ZIP has trailing or malformed data');
	if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error('Multi-disk ZIP files are not supported');
	if (entryCount === 0 || entryCount > MAX_ENTRY_COUNT) throw new Error(`Invalid ZIP entry count: ${entryCount}`);
	if (centralOffset + centralSize !== endOffset) throw new Error('ZIP central directory bounds are invalid');

	mkdirSync(destination, { recursive: true });
	const destinationRoot = resolve(destination);
	const seenNames = new Set();
	const dataRanges = [];
	let pointer = centralOffset;
	let totalExtracted = 0;

	for (let index = 0; index < entryCount; index += 1) {
		if (pointer + 46 > endOffset || archive.readUInt32LE(pointer) !== 0x02014b50) {
			throw new Error(`Invalid ZIP central entry ${index}`);
		}
		const flags = archive.readUInt16LE(pointer + 8);
		const method = archive.readUInt16LE(pointer + 10);
		const expectedCrc = archive.readUInt32LE(pointer + 16);
		const compressedSize = archive.readUInt32LE(pointer + 20);
		const uncompressedSize = archive.readUInt32LE(pointer + 24);
		const nameLength = archive.readUInt16LE(pointer + 28);
		const extraLength = archive.readUInt16LE(pointer + 30);
		const entryCommentLength = archive.readUInt16LE(pointer + 32);
		const startDisk = archive.readUInt16LE(pointer + 34);
		const externalAttributes = archive.readUInt32LE(pointer + 38);
		const localOffset = archive.readUInt32LE(pointer + 42);
		const entryEnd = pointer + 46 + nameLength + extraLength + entryCommentLength;
		if (entryEnd > endOffset) throw new Error(`ZIP central entry ${index} exceeds its directory`);
		const name = archive.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
		pointer = entryEnd;

		if ((flags & ~0x0800) !== 0) throw new Error(`Unsupported ZIP flags for ${name}`);
		if (method !== 0 || compressedSize !== uncompressedSize) throw new Error(`Only stored ZIP entries are allowed: ${name}`);
		if (startDisk !== 0) throw new Error(`Invalid disk number for ZIP entry: ${name}`);
		const unixMode = externalAttributes >>> 16;
		if ((unixMode & 0o170000) === 0o120000) throw new Error(`ZIP symlinks are forbidden: ${name}`);
		assertSafeEntryName(name);
		if (seenNames.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
		seenNames.add(name);

		if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) {
			throw new Error(`Invalid local ZIP header: ${name}`);
		}
		const localFlags = archive.readUInt16LE(localOffset + 6);
		const localMethod = archive.readUInt16LE(localOffset + 8);
		const localCrc = archive.readUInt32LE(localOffset + 14);
		const localCompressedSize = archive.readUInt32LE(localOffset + 18);
		const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
		if (localFlags !== flags || localMethod !== method || localCrc !== expectedCrc
			|| localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize || localName !== name) {
			throw new Error(`ZIP local and central metadata differ: ${name}`);
		}
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > centralOffset) throw new Error(`ZIP entry data exceeds its bounds: ${name}`);
		for (const [start, end] of dataRanges) {
			if (localOffset < end && dataEnd > start) throw new Error(`Overlapping ZIP entry data: ${name}`);
		}
		dataRanges.push([localOffset, dataEnd]);

		totalExtracted += uncompressedSize;
		if (totalExtracted > MAX_EXTRACTED_BYTES) throw new Error('ZIP exceeds the extracted-size limit');
		const data = archive.subarray(dataStart, dataEnd);
		if (crc32(data) !== expectedCrc) throw new Error(`ZIP CRC mismatch: ${name}`);

		const target = resolve(destinationRoot, ...name.split('/'));
		const targetRelative = relative(destinationRoot, target);
		if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
			throw new Error(`ZIP entry escaped the extraction root: ${name}`);
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, data, { flag: 'wx' });
	}

	if (pointer !== centralOffset + centralSize) throw new Error('ZIP central directory length does not match its entries');
	let coveredOffset = 0;
	for (const [start, end] of dataRanges.sort((left, right) => left[0] - right[0])) {
		if (start !== coveredOffset) throw new Error('ZIP contains unreferenced or non-contiguous local data');
		coveredOffset = end;
	}
	if (coveredOffset !== centralOffset) throw new Error('ZIP local data does not end at its central directory');
	if (!existsSync(resolve(destinationRoot, 'manifest.json'))) throw new Error('Extracted release is missing manifest.json');
	return { entryCount, totalExtracted };
}

export function verifyChecksum(
	archivePath,
	checksumPath = `${archivePath}.sha256`,
	expectedArchiveName = basename(archivePath),
) {
	if (!existsSync(archivePath) || !existsSync(checksumPath)) throw new Error('Release ZIP or SHA-256 file is missing');
	if (statSync(archivePath).size > MAX_ARCHIVE_BYTES || statSync(checksumPath).size > 256) {
		throw new Error('Release ZIP or SHA-256 file exceeds its size limit');
	}
	const line = readFileSync(checksumPath, 'utf8').trim();
	const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/u.exec(line);
	if (!match || match[2] !== expectedArchiveName) throw new Error('Malformed release SHA-256 file');
	const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
	if (actual !== match[1]) throw new Error('Release ZIP SHA-256 mismatch');
	return actual;
}

const RECEIPT_DOCUMENT_KEYS = new Set(['body', 'mac']);
const RECEIPT_BODY_KEYS = new Set([
	'version',
	'nonce',
	'createdAt',
	'expiresAt',
	'archivePath',
	'archiveSha256',
	'checksumSha256',
	'lockfileSha256',
	'sourceSha256',
	'gateResults',
]);
const RECEIPT_GATE_KEYS = new Set(['label', 'status']);

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
	const keys = Object.keys(value);
	return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function assertReceiptPath(receiptPath, consumed = false) {
	const normalized = resolve(receiptPath);
	const relativeReceipt = relative(resolve(tmpdir()), normalized).replaceAll('\\', '/');
	const suffix = consumed ? '\\.consumed' : '';
	if (!relativeReceipt || relativeReceipt.startsWith('..') || isAbsolute(relativeReceipt)
		|| !new RegExp(`^spectra-release-receipt-[^/]+/receipt\\.json${suffix}$`, 'u').test(relativeReceipt)) {
		throw new Error('Release promotion receipt path is invalid');
	}
	return normalized;
}

function currentReceiptFacts(archivePath, checksumPath, archiveDigest = sha256File(archivePath)) {
	return {
		archivePath: resolve(archivePath),
		archiveSha256: archiveDigest,
		checksumSha256: sha256File(checksumPath),
		lockfileSha256: sha256File(resolve(workspaceDir, 'bun.lock')),
		sourceSha256: computeReleaseSourceDigest(),
	};
}

function promotionAuthorizationFromEnvironment() {
	const receiptPath = process.env[RELEASE_RECEIPT_PATH_ENV];
	const capability = process.env[RELEASE_RECEIPT_CAPABILITY_ENV];
	const sourceDigest = process.env[RELEASE_SOURCE_DIGEST_ENV];
	if (!receiptPath || !capability) {
		throw new Error('Release promotion requires a one-time receipt from the complete release orchestrator');
	}
	if (!sourceDigest || !/^[a-f0-9]{64}$/u.test(sourceDigest)) {
		throw new Error('Release promotion requires the frozen source digest from the complete release orchestrator');
	}
	return { receiptPath: assertReceiptPath(receiptPath), capability, sourceDigest };
}

function assertFrozenSourceDigest(expectedDigest) {
	const currentDigest = computeReleaseSourceDigest();
	if (currentDigest !== expectedDigest) {
		throw new Error('Release source changed during extracted ZIP smoke; restart the complete release gate');
	}
	return currentDigest;
}

export function validatePromotionReceipt({ receiptPath, capability, expectedFacts, now = Date.now(), consumed = false }) {
	const normalizedPath = assertReceiptPath(receiptPath, consumed);
	if (!/^[a-f0-9]{64}$/u.test(capability)) throw new Error('Release promotion receipt capability is invalid');
	if (!existsSync(normalizedPath) || statSync(normalizedPath).size > MAX_RECEIPT_BYTES) {
		throw new Error('Release promotion receipt is missing or oversized');
	}
	let receipt: unknown;
	try {
		receipt = JSON.parse(readFileSync(normalizedPath, 'utf8'));
	} catch {
		throw new Error('Release promotion receipt is malformed');
	}
	if (!isRecord(receipt) || !hasExactKeys(receipt, RECEIPT_DOCUMENT_KEYS)
		|| !isRecord(receipt.body) || !hasExactKeys(receipt.body, RECEIPT_BODY_KEYS)
		|| typeof receipt.mac !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.mac)) {
		throw new Error('Release promotion receipt is malformed');
	}
	const body = receipt.body;
	const gateResultsValid = Array.isArray(body.gateResults)
		&& body.gateResults.length === RELEASE_REQUIRED_GATE_LABELS.length
		&& body.gateResults.every((gate, index) => isRecord(gate)
			&& hasExactKeys(gate, RECEIPT_GATE_KEYS)
			&& gate.label === RELEASE_REQUIRED_GATE_LABELS[index]
			&& gate.status === 'passed');
	const factsValid = isRecord(expectedFacts)
		&& body.archivePath === resolve(expectedFacts.archivePath)
		&& body.archiveSha256 === expectedFacts.archiveSha256
		&& body.checksumSha256 === expectedFacts.checksumSha256
		&& body.lockfileSha256 === expectedFacts.lockfileSha256
		&& body.sourceSha256 === expectedFacts.sourceSha256;
	if (body.version !== RELEASE_RECEIPT_VERSION
		|| !/^[a-f0-9]{32}$/u.test(body.nonce)
		|| !Number.isSafeInteger(body.createdAt)
		|| !Number.isSafeInteger(body.expiresAt)
		|| body.createdAt > now + 5_000
		|| body.expiresAt < now
		|| body.expiresAt - body.createdAt !== RELEASE_RECEIPT_TTL_MS
		|| !gateResultsValid
		|| !factsValid) {
		throw new Error('Release promotion receipt is invalid, stale, incomplete, or bound to different inputs');
	}
	const expectedMac = createHmac('sha256', capability).update(JSON.stringify(body)).digest();
	const actualMac = Buffer.from(receipt.mac, 'hex');
	if (actualMac.length !== expectedMac.length || !timingSafeEqual(actualMac, expectedMac)) {
		throw new Error('Release promotion receipt authentication failed');
	}
	return receipt;
}

export function consumePromotionReceipt({ receiptPath, capability, expectedFacts, now = Date.now() }) {
	const normalizedPath = assertReceiptPath(receiptPath);
	const consumedPath = `${normalizedPath}.consumed`;
	if (existsSync(consumedPath)) throw new Error('Release promotion receipt was already consumed');
	renameSync(normalizedPath, consumedPath);
	try {
		const receipt = validatePromotionReceipt({
			receiptPath: consumedPath,
			capability,
			expectedFacts,
			now,
			consumed: true,
		});
		return { consumedPath, receipt };
	} catch (error) {
		rmSync(consumedPath, { force: true });
		throw error;
	}
}

function attemptOperation(errors, label, operation) {
	try {
		operation();
	} catch (error) {
		errors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
	}
}

export function promoteStagedRelease(
	archivePath,
	checksumPath,
	expectedDigest,
	{
		releaseDirectory = releaseDir,
		archiveFileName = archiveName,
		operations = {},
		assertSourceUnchanged,
	} = {},
) {
	const fs = {
		copy: operations.copy ?? copyFileSync,
		exists: operations.exists ?? existsSync,
		mkdir: operations.mkdir ?? mkdirSync,
		remove: operations.remove ?? rmSync,
		rename: operations.rename ?? renameSync,
	};
	const expectedArchive = resolve(releaseDirectory, '.staging', archiveFileName);
	if (resolve(archivePath) !== expectedArchive || resolve(checksumPath) !== `${expectedArchive}.sha256`) {
		throw new Error('Only the canonical staged release can be promoted');
	}
	fs.mkdir(releaseDirectory, { recursive: true });
	const finalArchive = resolve(releaseDirectory, archiveFileName);
	const finalChecksum = `${finalArchive}.sha256`;
	const suffix = `.tmp-${process.pid}`;
	const temporaryArchive = `${finalArchive}${suffix}`;
	const temporaryChecksum = `${finalChecksum}${suffix}`;
	const backupArchive = `${finalArchive}.previous-${process.pid}`;
	const backupChecksum = `${finalChecksum}.previous-${process.pid}`;
	for (const path of [temporaryArchive, temporaryChecksum]) fs.remove(path, { force: true });
	if (fs.exists(backupArchive) || fs.exists(backupChecksum)) {
		throw new Error('A previous release backup requires manual recovery before promotion');
	}

	let archiveBackedUp = false;
	let checksumBackedUp = false;
	let archiveInstalled = false;
	let checksumInstalled = false;
	let committed = false;
	try {
		fs.copy(archivePath, temporaryArchive);
		fs.copy(checksumPath, temporaryChecksum);
		if (verifyChecksum(archivePath, checksumPath) !== expectedDigest
			|| verifyChecksum(temporaryArchive, temporaryChecksum, archiveFileName) !== expectedDigest) {
			throw new Error('Copied release pair failed promotion verification');
		}
		assertSourceUnchanged?.();
		if (fs.exists(finalArchive)) {
			fs.rename(finalArchive, backupArchive);
			archiveBackedUp = true;
		}
		if (fs.exists(finalChecksum)) {
			fs.rename(finalChecksum, backupChecksum);
			checksumBackedUp = true;
		}
		fs.rename(temporaryArchive, finalArchive);
		archiveInstalled = true;
		fs.rename(temporaryChecksum, finalChecksum);
		checksumInstalled = true;
		if (verifyChecksum(finalArchive, finalChecksum) !== expectedDigest) {
			throw new Error('Promoted release pair failed final verification');
		}
		// Keep the previous pair until the frozen source is checked again. A
		// failure here enters the transaction rollback path and cannot leave the
		// candidate installed as the official release.
		assertSourceUnchanged?.();
		committed = true;
	} catch (error) {
		const rollbackErrors = [];
		if (checksumInstalled) {
			attemptOperation(rollbackErrors, 'remove installed checksum', () => fs.remove(finalChecksum, { force: true }));
		}
		if (archiveInstalled) {
			attemptOperation(rollbackErrors, 'remove installed archive', () => fs.remove(finalArchive, { force: true }));
		}
		if (archiveBackedUp) {
			attemptOperation(rollbackErrors, 'restore previous archive', () => fs.rename(backupArchive, finalArchive));
		}
		if (checksumBackedUp) {
			attemptOperation(rollbackErrors, 'restore previous checksum', () => fs.rename(backupChecksum, finalChecksum));
		}
		attemptOperation(rollbackErrors, 'remove temporary archive', () => fs.remove(temporaryArchive, { force: true }));
		attemptOperation(rollbackErrors, 'remove temporary checksum', () => fs.remove(temporaryChecksum, { force: true }));
		if (rollbackErrors.length) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				'Release promotion failed and its previous candidate needs manual recovery',
			);
		}
		throw error;
	}

	if (!committed) throw new Error('Release promotion did not reach a committed state');
	const cleanupErrors = [];
	attemptOperation(cleanupErrors, 'remove previous archive backup', () => fs.remove(backupArchive, { force: true }));
	attemptOperation(cleanupErrors, 'remove previous checksum backup', () => fs.remove(backupChecksum, { force: true }));
	attemptOperation(cleanupErrors, 'remove temporary archive', () => fs.remove(temporaryArchive, { force: true }));
	attemptOperation(cleanupErrors, 'remove temporary checksum', () => fs.remove(temporaryChecksum, { force: true }));
	attemptOperation(cleanupErrors, 'remove staging directory', () => (
		fs.remove(resolve(releaseDirectory, '.staging'), { recursive: true, force: true })
	));
	for (const cleanupError of cleanupErrors) console.warn(`SPECTRA promotion cleanup warning: ${cleanupError.message}`);
	console.log(`✓ Promoted validated release/${archiveFileName}`);
	return { finalArchive, finalChecksum };
}

export function runReleaseSmoke({ stage = false, promote = false, archivePath: requestedArchive } = {}) {
	if (promote && !stage) throw new Error('--promote requires --stage');
	const authorization = promote ? promotionAuthorizationFromEnvironment() : null;
	if (promote && Bun.version !== '1.3.14') {
		throw new Error(`Release promotion requires Bun 1.3.14, found ${Bun.version}`);
	}
	const defaultArchive = resolve(releaseDir, stage ? '.staging' : '', archiveName);
	const archivePath = resolve(requestedArchive ?? process.env.SPECTRA_ARCHIVE_PATH ?? defaultArchive);
	const checksumPath = `${archivePath}.sha256`;
	const digest = verifyChecksum(archivePath, checksumPath);
	if (authorization) {
		assertFrozenSourceDigest(authorization.sourceDigest);
		validatePromotionReceipt({
			...authorization,
			expectedFacts: currentReceiptFacts(archivePath, checksumPath, digest),
		});
	}
	const extractionDir = mkdtempSync(resolve(tmpdir(), 'spectra-release-smoke-'));
	try {
		const extracted = extractStoredZip(archivePath, extractionDir);
		console.log(`✓ Extracted ${extracted.entryCount} files (${(extracted.totalExtracted / 1024).toFixed(1)}KiB), SHA-256 ${digest}`);
		const smokeEnvironment = { ...process.env, SPECTRA_EXTENSION_DIR: extractionDir };
		delete smokeEnvironment[RELEASE_RECEIPT_PATH_ENV];
		delete smokeEnvironment[RELEASE_RECEIPT_CAPABILITY_ENV];
		const result = spawnSync(process.execPath, ['test', 'test/smoke.spec.ts'], {
			cwd: projectDir,
			env: smokeEnvironment,
			stdio: 'inherit',
			shell: false,
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`Extracted release smoke failed with exit code ${result.status ?? 'unknown'}`);
		if (authorization) {
			const currentDigest = verifyChecksum(archivePath, checksumPath);
			assertFrozenSourceDigest(authorization.sourceDigest);
			const consumed = consumePromotionReceipt({
				...authorization,
				expectedFacts: currentReceiptFacts(archivePath, checksumPath, currentDigest),
			});
			try {
				promoteStagedRelease(archivePath, checksumPath, currentDigest, {
					assertSourceUnchanged: () => assertFrozenSourceDigest(authorization.sourceDigest),
				});
			} finally {
				rmSync(consumed.consumedPath, { force: true });
			}
		}
		return { archivePath, digest, ...extracted };
	} finally {
		rmSync(extractionDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

function printHelp() {
	console.log('Usage: bun scripts/smoke-release.ts [--stage] [--promote] [--archive <path>]');
	console.log('  --stage       Verify release/.staging instead of the current release.');
	console.log('  --promote     Internal release-gate operation; use bun run release:spectra.');
	console.log('  --archive     Verify an explicit ZIP path; can also use SPECTRA_ARCHIVE_PATH.');
}

function parseArgs(args) {
	let stage = false;
	let promote = false;
	let archivePath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--stage') stage = true;
		else if (arg === '--promote') promote = true;
		else if (arg === '--archive') {
			archivePath = args[++index];
			if (!archivePath) throw new Error('--archive requires a path');
		} else throw new Error(`Unknown smoke-release option: ${arg}`);
	}
	return { stage, promote, archivePath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) printHelp();
	else runReleaseSmoke(parseArgs(args));
}