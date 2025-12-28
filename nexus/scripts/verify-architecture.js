/**
 * Architecture Integrity Verification Script v5
 * 
 * Checks: .ai-context.md | contracts purity | file length | hardcoded actions | deps | HTML | Chinese
 * Usage: node scripts/verify-architecture.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { counters } from './verify/utils.js';
import { checkAiContextFiles } from './verify/check-ai-context.js';
import { checkContractsPurity } from './verify/check-contracts.js';
import { checkSourceFileLength } from './verify/check-file-length.js';
import { checkHardcodedActions } from './verify/check-actions.js';
import { checkDependencyDirection, checkReadmeAI, checkHtmlResources } from './verify/check-misc.js';
import { checkChineseComments } from './verify/check-chinese.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function main() {
	console.log('='.repeat(60));
	console.log('🔍 Project NEXUS Architecture Verify v5');
	console.log('='.repeat(60));

	checkAiContextFiles(ROOT);
	checkContractsPurity(ROOT);
	checkReadmeAI(ROOT);
	checkDependencyDirection(ROOT);
	checkSourceFileLength(ROOT);
	checkHardcodedActions(ROOT);
	checkHtmlResources(ROOT);
	checkChineseComments(ROOT);

	console.log('\n' + '='.repeat(60));
	if (counters.errors > 0) {
		console.log(`${RED}❌ Found ${counters.errors} errors, ${counters.warnings} warnings${RESET}`);
		console.log(`${RED}Please fix errors before committing${RESET}`);
		process.exit(1);
	} else if (counters.warnings > 0) {
		console.log(`${YELLOW}⚠️  Found ${counters.warnings} warnings${RESET}`);
	} else {
		console.log(`${GREEN}✅ All checks passed!${RESET}`);
	}
	console.log('='.repeat(60));
}

main();
