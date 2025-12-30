/**
 * Architecture verification utility functions
 */

import fs from 'fs';
import path from 'path';

// Color output codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Error and warning counters */
export const counters = { errors: 0, warnings: 0 };

export function error(msg) {
	console.log(`${RED}❌ ERROR${RESET}: ${msg}`);
	counters.errors++;
}

export function warn(msg) {
	console.log(`${YELLOW}⚠️  WARN${RESET}: ${msg}`);
	counters.warnings++;
}

export function ok(msg) {
	console.log(`${GREEN}✅ OK${RESET}: ${msg}`);
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
