/**
 * 架构完整性验证脚本 v4
 * 
 * 检查项：.ai-context.md | contracts纯净性 | 源码行数 | 硬编码Action | 依赖方向 | HTML引用
 * 使用：node scripts/verify-architecture.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { counters } from './verify/utils.js';
import { checkAiContextFiles } from './verify/check-ai-context.js';
import { checkContractsPurity } from './verify/check-contracts.js';
import { checkSourceFileLength } from './verify/check-file-length.js';
import { checkHardcodedActions } from './verify/check-actions.js';
import { checkDependencyDirection, checkReadmeAI, checkHtmlResources } from './verify/check-misc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function main() {
	console.log('='.repeat(60));
	console.log('🔍 Project NEXUS 架构完整性验证 v4');
	console.log('='.repeat(60));

	checkAiContextFiles(ROOT);
	checkContractsPurity(ROOT);
	checkReadmeAI(ROOT);
	checkDependencyDirection(ROOT);
	checkSourceFileLength(ROOT);
	checkHardcodedActions(ROOT);
	checkHtmlResources(ROOT);

	console.log('\n' + '='.repeat(60));
	if (counters.errors > 0) {
		console.log(`${RED}❌ 检测到 ${counters.errors} 个错误，${counters.warnings} 个警告${RESET}`);
		console.log(`${RED}请修复上述错误后再提交代码${RESET}`);
		process.exit(1);
	} else if (counters.warnings > 0) {
		console.log(`${YELLOW}⚠️  检测到 ${counters.warnings} 个警告${RESET}`);
	} else {
		console.log(`${GREEN}✅ 所有检查通过！${RESET}`);
	}
	console.log('='.repeat(60));
}

main();
