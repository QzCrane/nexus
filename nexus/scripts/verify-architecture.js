/**
 * Architecture Integrity Verification Script v6
 * 
 * Usage: node scripts/verify-architecture.js [-q|--quiet] [-v|--verbose]
 * -q: minimal output (errors + summary only)
 * -v: verbose output (show all warnings)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { counters, quiet } from './verify/utils.js';
import { checkAiContextFiles } from './verify/check-ai-context.js';
import { checkContractsPurity } from './verify/check-contracts.js';
import { checkSourceFileLength } from './verify/check-file-length.js';
import { checkHardcodedActions } from './verify/check-actions.js';
import { checkDependencyDirection, checkReadmeAI, checkHtmlResources } from './verify/check-misc.js';
import { checkChineseComments } from './verify/check-chinese.js';
import { checkPermissionUsage } from './verify/check-permissions.js';
import { checkSpectraControlArchitecture } from './verify/check-spectra-control.js';
import { checkAiHygiene } from './verify/check-ai-hygiene.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function main() {
	if (!quiet) {
		console.log('🔍 verify-architecture v6');
	}

	checkAiContextFiles(ROOT);
	checkContractsPurity(ROOT);
	checkReadmeAI(ROOT);
	checkDependencyDirection(ROOT);
	checkSourceFileLength(ROOT);
	checkHardcodedActions(ROOT);
	checkHtmlResources(ROOT);
	checkPermissionUsage(ROOT);
	checkSpectraControlArchitecture(ROOT);
	checkChineseComments(ROOT);
	checkAiHygiene(ROOT);

	if (counters.errors > 0) {
		console.log(`${RED}❌ verify: ${counters.errors} errors, ${counters.warnings} warnings${RESET}`);
		process.exit(1);
	} else if (counters.warnings > 0) {
		console.log(`${YELLOW}⚠️  verify: ${counters.warnings} warnings${RESET}`);
	} else {
		console.log(`${GREEN}✓ verify: OK${RESET}`);
	}
}

main();
