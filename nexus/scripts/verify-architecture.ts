/**
 * Architecture Integrity Verification Script v6
 * 
 * Usage: node scripts/verify-architecture.ts [-q|--quiet] [-v|--verbose]
 * -q: minimal output (errors + summary only)
 * -v: verbose output (show all warnings)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { counters, error, quiet } from './verify/utils.ts';
import { checkAiContextFiles } from './verify/check-ai-context.ts';
import { checkContractsPurity } from './verify/check-contracts.ts';
import { checkDeclarationOwnership } from './verify/check-declaration-ownership.ts';
import { checkContentResponseCoverage } from './verify/check-content-response-coverage.ts';
import { checkSourceFileLength } from './verify/check-file-length.ts';
import { checkHardcodedActions } from './verify/check-actions.ts';
import { checkDependencyDirection, checkReadmeAI, checkHtmlResources } from './verify/check-misc.ts';
import { checkChineseComments } from './verify/check-chinese.ts';
import { checkPermissionUsage } from './verify/check-permissions.ts';
import { checkRemoteProjection } from './verify/check-remote-projection.ts';
import { checkSpectraControlArchitecture } from './verify/check-spectra-control.ts';
import { checkAiHygiene } from './verify/check-ai-hygiene.ts';
import { checkSourcePurity } from './verify/check-source-purity.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const CHECKS: ReadonlyArray<readonly [string, (root: string) => void]> = [
	['ai-context', checkAiContextFiles],
	['contracts-purity', checkContractsPurity],
	['declaration-ownership', checkDeclarationOwnership],
	['content-response-coverage', checkContentResponseCoverage],
	['readme-entry', checkReadmeAI],
	['dependency-direction', checkDependencyDirection],
	['source-file-length', checkSourceFileLength],
	['hardcoded-actions', checkHardcodedActions],
	['html-resources', checkHtmlResources],
	['remote-projection', checkRemoteProjection],
	['permission-usage', checkPermissionUsage],
	['spectra-control', checkSpectraControlArchitecture],
	['chinese-comments', checkChineseComments],
	['ai-hygiene', checkAiHygiene],
	['source-purity', checkSourcePurity],
];

interface CheckResult {
	name: string;
	errors: number;
	warnings: number;
}

/**
 * 每个检查独立隔离：任一检查抛错都只记为该检查的失败，
 * 后续检查必须继续执行，最终汇总逐项结果。
 */
function runChecks(): CheckResult[] {
	return CHECKS.map(([name, run]) => {
		const before = { ...counters };
		try {
			run(ROOT);
		} catch (cause) {
			error(`${name} crashed: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
		return {
			name,
			errors: counters.errors - before.errors,
			warnings: counters.warnings - before.warnings,
		};
	});
}

function main() {
	if (!quiet) {
		console.log('🔍 verify-architecture v6');
	}

	const results = runChecks();

	for (const result of results) {
		const status = result.errors > 0 ? `${RED}✗${RESET}` : result.warnings > 0 ? `${YELLOW}•${RESET}` : `${GREEN}✓${RESET}`;
		console.log(`${status} ${result.name}: ${result.errors} errors, ${result.warnings} warnings`);
	}

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
