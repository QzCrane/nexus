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
        const content = fs.readFileSync(contextFile, 'utf-8');
        const lineCount = content.split('\n').length;
        if (lineCount > 30) {
          error(`${base}/${entry.name}/.ai-context.md 超过 30 行 (当前 ${lineCount} 行)！`);
        } else {
          ok(`${base}/${entry.name}/.ai-context.md 存在 (${lineCount} 行)`);
        }
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
// 检查 6：源码文件行数
// ============================================
function checkSourceFileLength() {
  console.log('\n📋 检查源码文件行数 (上限 200 行)...\n');
  
  const MAX_LINES = 200;
  
  // 历史技术债豁免列表 (显示为警告而非错误)
  // TODO: 逐步拆分这些文件后从列表中移除
  const LEGACY_OVERSIZE_FILES = [
    'packages/contracts/src/messages.contracts.ts',
    'packages/nexus-kernel/src/storage/repository.ts',
    'packages/features/audio-engine/src/constants.ts',
    'packages/features/audio-engine/src/PolicyEngine.ts',
    'packages/features/audio-engine/src/WebAudioController.ts'
  ];
  
  const srcDirs = [
    'packages/contracts/src',
    'packages/nexus-kernel/src',
    'packages/features/audio-engine/src',
    'apps/extension-spectra/src'
  ];
  
  let oversizeFiles = [];
  let legacyOversizeFiles = [];
  
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lineCount = content.split('\n').length;
        const relativePath = fullPath.replace(ROOT + path.sep, '').replace(/\\/g, '/');
        if (lineCount > MAX_LINES) {
          if (LEGACY_OVERSIZE_FILES.includes(relativePath)) {
            legacyOversizeFiles.push({ path: relativePath, lines: lineCount });
          } else {
            oversizeFiles.push({ path: relativePath, lines: lineCount });
          }
        }
      }
    }
  }
  
  for (const srcDir of srcDirs) {
    scanDir(path.join(ROOT, srcDir));
  }
  
  // 新增超标文件 → 错误
  if (oversizeFiles.length > 0) {
    for (const file of oversizeFiles) {
      error(`${file.path} 超过 ${MAX_LINES} 行 (当前 ${file.lines} 行)！`);
    }
  }
  
  // 历史债务文件 → 警告
  if (legacyOversizeFiles.length > 0) {
    for (const file of legacyOversizeFiles) {
      warn(`[历史债务] ${file.path} 超过 ${MAX_LINES} 行 (当前 ${file.lines} 行)`);
    }
  }
  
  if (oversizeFiles.length === 0 && legacyOversizeFiles.length === 0) {
    ok('所有源码文件均 ≤ 200 行');
  } else if (oversizeFiles.length === 0) {
    ok('无新增超标文件');
  }
}

// ============================================
// 检查 7：硬编码 Action 字符串
// ============================================
function checkHardcodedActions() {
  console.log('\n📋 检查硬编码的 Action 字符串...\n');
  
  // 从 actions.ts 动态读取 Action 列表 (单一真相源)
  const actionsFile = path.join(ROOT, 'packages/contracts/src/actions.ts');
  if (!fs.existsSync(actionsFile)) {
    warn('actions.ts 不存在，跳过硬编码检查');
    return;
  }
  
  const actionsContent = fs.readFileSync(actionsFile, 'utf-8');
  const actionMatches = actionsContent.match(/'[A-Z_]+'/g) || [];
  const KNOWN_ACTIONS = [...new Set(actionMatches.map(m => m.replace(/'/g, '')))];
  
  if (KNOWN_ACTIONS.length === 0) {
    warn('未能从 actions.ts 解析出 Action 列表');
    return;
  }
  
  const violations = [];
  
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const relativePath = fullPath.replace(ROOT + path.sep, '').replace(/\\/g, '/');
        // 跳过常量定义文件
        if (relativePath.includes('actions.ts')) continue;
        if (relativePath.includes('messages.contracts.ts')) continue;
        if (relativePath.includes('messages/definitions.ts')) continue;
        
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const action of KNOWN_ACTIONS) {
            const patterns = [
              `action: '${action}'`,
              `action: "${action}"`,
              `case '${action}':`,
              `case "${action}":`,
            ];
            for (const pattern of patterns) {
              if (line.includes(pattern)) {
                violations.push({ path: relativePath, line: i + 1, action });
              }
            }
          }
        }
      }
    }
  }
  
  scanDir(path.join(ROOT, 'apps/extension-spectra/src'));
  
  if (violations.length > 0) {
    for (const v of violations) {
      error(`硬编码 Action: ${v.path}:${v.line} (${v.action}) - 应使用 Actions 常量`);
    }
  } else {
    ok(`无硬编码的 Action 字符串 (检查了 ${KNOWN_ACTIONS.length} 个 Action)`);
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
  checkSourceFileLength();
  checkHardcodedActions();
  
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
