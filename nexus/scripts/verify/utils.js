/**
 * Architecture verification utility functions
 */

import fs from 'fs';
import path from 'path';

// Color output codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

/** Error and warning counters */
export const counters = { errors: 0, warnings: 0 };

/** Verbose mode: set to false to suppress warning details */
export let verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

export function error(msg) {
	console.log(`${RED}❌ ERROR${RESET}: ${msg}`);
	counters.errors++;
}

export function warn(msg, silent = false) {
	counters.warnings++;
	if (!silent && verbose) {
		console.log(`${YELLOW}⚠️  WARN${RESET}: ${msg}`);
	}
}

export function ok(msg) {
	console.log(`${GREEN}✅ OK${RESET}: ${msg}`);
}

export function summary(label, count, type = 'warn') {
	if (count > 0) {
		const color = type === 'error' ? RED : YELLOW;
		console.log(`${color}${type === 'error' ? '❌' : '⚠️ '} ${label}: ${count}${RESET}`);
	}
}

/** Recursively scan directory */
export function scanDir(dir, callback) {
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			scanDir(fullPath, callback);
		} else {
			callback(fullPath, entry);
		}
	}
}
