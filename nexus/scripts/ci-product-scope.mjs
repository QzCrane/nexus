#!/usr/bin/env node
// goal: one executable, unit-testable PR product-scope classifier for GitHub Actions
// inv: unknown paths fail closed to both products; only explicit documentation paths may skip both

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SPECTRA_PREFIXES = Object.freeze([
	'nexus/apps/extension-spectra/',
	'remote-site/',
]);
const HALO_PREFIXES = Object.freeze([
	'nexus/apps/extension-halo/',
]);
const DOC_PREFIXES = Object.freeze([
	'docs/',
	'nexus/docs/',
]);
const ROOT_DOCUMENTATION_FILES = new Set([
	'AGENTS.md',
	'CHANGELOG.md',
	'CODE_OF_CONDUCT.md',
	'CONTRIBUTING.md',
	'LICENSE',
	'LICENSE.md',
	'README.md',
	'SECURITY.md',
	'rules.md',
]);

function hasPrefix(path, prefixes) {
	return prefixes.some((prefix) => path.startsWith(prefix));
}

export function isDocumentationOnlyPath(path) {
	return ROOT_DOCUMENTATION_FILES.has(path) || hasPrefix(path, DOC_PREFIXES);
}

export function classifyChangedPaths(paths, eventName = 'pull_request') {
	if (eventName !== 'pull_request') return { spectra: true, halo: true, reason: 'non-pr' };
	if (paths.length === 0) return { spectra: true, halo: true, reason: 'empty-diff' };

	let spectra = false;
	let halo = false;
	for (const path of paths) {
		if (typeof path !== 'string' || path.length === 0) {
			return { spectra: true, halo: true, reason: 'invalid-path' };
		}
		if (hasPrefix(path, SPECTRA_PREFIXES)) {
			spectra = true;
			continue;
		}
		if (hasPrefix(path, HALO_PREFIXES)) {
			halo = true;
			continue;
		}
		if (isDocumentationOnlyPath(path)) continue;
		return { spectra: true, halo: true, reason: `shared-or-unknown:${path}` };
	}
	return { spectra, halo, reason: spectra || halo ? 'product-scoped' : 'docs-only' };
}

export function parseNulSeparatedPaths(buffer) {
	const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	if (bytes.length === 0) return [];
	const records = bytes.toString('utf8').split('\0');
	if (records.at(-1) === '') records.pop();
	if (records.some((record) => record.length === 0)) {
		throw new Error('Changed-path stream contains an empty record');
	}
	return records;
}

function argumentValue(args, name) {
	const index = args.indexOf(name);
	if (index < 0 || index + 1 >= args.length) throw new Error(`Missing ${name}`);
	return args[index + 1];
}

export function runCli(args = process.argv.slice(2)) {
	const eventName = argumentValue(args, '--event');
	let paths = [];
	if (eventName === 'pull_request') {
		const pathFile = argumentValue(args, '--paths-z-file');
		paths = parseNulSeparatedPaths(readFileSync(pathFile));
	}
	const result = classifyChangedPaths(paths, eventName);
	process.stdout.write(`spectra=${result.spectra}\nhalo=${result.halo}\n`);
	process.stderr.write(`[scope] ${result.reason}: SPECTRA=${result.spectra} HALO=${result.halo}\n`);
	return result;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		runCli();
	} catch (error) {
		console.error(`[scope] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
