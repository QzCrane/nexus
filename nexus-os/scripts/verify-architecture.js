/**
 * 架构完整性验证脚本 v2
 * 
 * 检查：
 * 1. 所有 packages/apps 是否有对应的 .ai-context.md
 * 2. contracts 包是否纯净（零依赖，无实现代码）
 * 3. README.AI.md 是否存在且消息表是否同步
 * 4. kernel/protocol.ts 是否重复定义了 contracts 中的类型
 * 5. 依赖方向是否正确
 * 
 * 使用方式：node scripts/verify-architecture.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// 颜色输出
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let errors = 0;
let warnings = 0;

function error(msg) {
  console.log(`${RED}❌ ERROR${RESET}: ${msg}`);
  errors++;
}

function warn(msg) {
  console.log(`${YELLOW}⚠️  WARN${RESET}: ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`${GREEN}✅ OK${RESET}: ${msg}`);
}

// ============================================
// 检查 1：自动扫描所有模块的 .ai-context.md
// ============================================
function checkAiContextFiles() {
  console.log('\n📋 检查 .ai-context.md 文件...\n');
  
  // 自动扫描 packages 和 apps
  const dirsToScan = [
    { base: 'packages', depth: 1 },        // packages/nexus-kernel
    { base: 'packages/features', depth: 1 }, // packages/features/audio-engine
    { base: 'apps', depth: 1 }              // apps/extension-spectra
  ];
  
  for (const { base, depth } of dirsToScan) {
    const basePath = path.join(ROOT, base);
    if (!fs.existsSync(basePath)) continue;
    
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'contracts') continue;
      
      const pkgPath = path.join(basePath, entry.name);
      const contextFile = path.join(pkgPath, '.ai-context.md');
      const packageJson = path.join(pkgPath, 'package.json');
      
      // 只检查有 package.json 的目录
      if (!fs.existsSync(packageJson)) continue;
      
      if (fs.existsSync(contextFile)) {
        ok(`${base}/${entry.name}/.ai-context.md 存在`);
      } else {
        error(`${base}/${entry.name}/.ai-context.md 缺失！`);
      }
    }
  }
}

// ============================================
// 检查 2：contracts 包纯净性
// ============================================
function checkContractsPurity() {
  console.log('\n📋 检查 contracts 包纯净性...\n');
  
  const packageJson = path.join(ROOT, 'packages/contracts/package.json');
  if (!fs.existsSync(packageJson)) {
    error('packages/contracts/package.json 不存在！');
    return;
  }
  
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
  
  // 检查 dependencies
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    error(`contracts 包有 dependencies: ${JSON.stringify(pkg.dependencies)}`);
  } else {
    ok('contracts 包没有 runtime dependencies');
  }
  
  // 检查是否有实现代码（函数体、class 等）
  const srcDir = path.join(ROOT, 'packages/contracts/src');
  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
      // 检查是否有非 interface/type/const 的实现
      if (content.includes('function ') && !content.includes('type ') && !content.includes('interface ')) {
        warn(`contracts/${file} 可能包含实现代码`);
      }
    }
  }
}

// ============================================
// 检查 3：README.AI.md 同步
// ============================================
function checkReadmeAI() {
  console.log('\n📋 检查 README.AI.md...\n');
  
  const readmeAI = path.join(ROOT, 'README.AI.md');
  if (!fs.existsSync(readmeAI)) {
    error('README.AI.md 缺失！');
    return;
  }
  
  ok('README.AI.md 存在');
  
  // 读取 contracts 中的消息类型
  const messagesFile = path.join(ROOT, 'packages/contracts/src/messages.contracts.ts');
  if (fs.existsSync(messagesFile)) {
    const messagesContent = fs.readFileSync(messagesFile, 'utf-8');
    const readmeContent = fs.readFileSync(readmeAI, 'utf-8');
    
    // 提取消息类型名称
    const messageNames = messagesContent.match(/'[A-Z_]+'/g) || [];
    const uniqueMessages = [...new Set(messageNames.map(m => m.replace(/'/g, '')))];
    
    // 检查 README 中是否提及这些消息
    let missingInReadme = [];
    for (const msg of uniqueMessages.slice(0, 5)) { // 只检查前5个主要消息
      if (!readmeContent.includes(msg)) {
        missingInReadme.push(msg);
      }
    }
    
    if (missingInReadme.length > 0) {
      warn(`README.AI.md 消息速查表可能缺少: ${missingInReadme.join(', ')}`);
    } else {
      ok('README.AI.md 消息速查表包含主要消息');
    }
  }
}

// ============================================
// 检查 4：消息定义重复
// ============================================
function checkDuplicateDefinitions() {
  console.log('\n📋 检查重复定义...\n');
  
  const kernelProtocol = path.join(ROOT, 'packages/nexus-kernel/src/messages/protocol.ts');
  const contractsMessages = path.join(ROOT, 'packages/contracts/src/messages.contracts.ts');
  
  if (fs.existsSync(kernelProtocol) && fs.existsSync(contractsMessages)) {
    const kernelContent = fs.readFileSync(kernelProtocol, 'utf-8');
    const contractsContent = fs.readFileSync(contractsMessages, 'utf-8');
    
    // 检查 kernel 中是否还有 NexusMessages 定义
    if (kernelContent.includes('interface NexusMessages') && contractsContent.includes('interface NexusMessages')) {
      warn('[待迁移] NexusMessages 在 kernel 和 contracts 中都有定义');
      warn('[待迁移] 应删除 kernel/protocol.ts 中的定义，改为从 contracts 导入');
    }
    
    // 检查 kernel 中是否还有 AudioConfig 定义
    if (kernelContent.includes('interface AudioConfig') && contractsContent.includes('interface AudioConfig')) {
      warn('AudioConfig 在 kernel 和 contracts 中可能都有定义');
    }
  }
}

// ============================================
// 检查 5：依赖方向
// ============================================
function checkDependencyDirection() {
  console.log('\n📋 检查依赖方向...\n');
  
  // contracts 不应该依赖任何其他包
  const contractsPkg = path.join(ROOT, 'packages/contracts/package.json');
  if (fs.existsSync(contractsPkg)) {
    const pkg = JSON.parse(fs.readFileSync(contractsPkg, 'utf-8'));
    const deps = pkg.dependencies || {};
    
    const forbiddenDeps = Object.keys(deps).filter(d => 
      d.startsWith('@nexus/') && d !== '@nexus/contracts'
    );
    
    if (forbiddenDeps.length > 0) {
      error(`contracts 包依赖了其他 @nexus 包: ${forbiddenDeps.join(', ')}`);
    } else {
      ok('contracts 包依赖方向正确');
    }
  }
  
  // kernel 不应该依赖 audio-engine
  const kernelPkg = path.join(ROOT, 'packages/nexus-kernel/package.json');
  if (fs.existsSync(kernelPkg)) {
    const pkg = JSON.parse(fs.readFileSync(kernelPkg, 'utf-8'));
    const deps = pkg.dependencies || {};
    
    if (deps['@nexus/audio-engine']) {
      error('kernel 包依赖了 audio-engine！这是反向依赖');
    } else {
      ok('kernel 包依赖方向正确');
    }
  }
}

// ============================================
// 主函数
// ============================================
function main() {
  console.log('='.repeat(60));
  console.log('🔍 Project NEXUS 架构完整性验证 v2');
  console.log('='.repeat(60));
  
  checkAiContextFiles();
  checkContractsPurity();
  checkReadmeAI();
  checkDuplicateDefinitions();
  checkDependencyDirection();
  
  console.log('\n' + '='.repeat(60));
  if (errors > 0) {
    console.log(`${RED}❌ 检测到 ${errors} 个错误，${warnings} 个警告${RESET}`);
    console.log(`${RED}请修复上述错误后再提交代码${RESET}`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${YELLOW}⚠️  检测到 ${warnings} 个警告${RESET}`);
  } else {
    console.log(`${GREEN}✅ 所有检查通过！${RESET}`);
  }
  console.log('='.repeat(60));
}

main();
