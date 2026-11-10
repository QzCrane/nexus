// goal: run the public-snapshot parity gate at the publication boundary
// inv: a source build stays a function of this repository alone, never of a sibling checkout

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublicParity } from './verify/check-public-parity.ts';
import { counters } from './verify/utils.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
checkPublicParity(root);

if (counters.errors > 0) {
	console.error(`❌ public parity: ${counters.errors} errors, ${counters.warnings} warnings`);
	process.exit(1);
}
console.log(`✓ public parity: OK${counters.warnings > 0 ? ` (${counters.warnings} warnings)` : ''}`);
