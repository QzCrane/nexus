/**
 * NEXUS 符号索引检查器
 * 
 * 功能：
 * 1. 扫描所有包的导出符号
 * 2. 检查每个导出是否被引用
 * 3. 删除代码时自动提示需要同步删除的引用
 * 
 * 用法：node scripts/check-exports.js [--unused] [--refs SYMBOL]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEXUS_ROOT = path.join(__dirname, '..');
const PACKAGES = [
  'packages/contracts',
  'packages/nexus-kernel',
  'packages/features/audio-engine',
];

// 提取文件中的导出符号
function extractExports(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const exports = [];

  // export const/function/class NAME
  const namedExports = content.matchAll(/export\s+(const|function|class|interface|type|enum)\s+(\w+)/g);
  for (const match of namedExports) {
    exports.push(match[2]);
  }

  // export { NAME }
  const bracketExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of bracketExports) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    exports.push(...names.filter(n => n && !n.startsWith('*')));
  }

  return exports;
}

// 搜索符号引用
function findReferences(symbol, excludeDir) {
  const refs = [];
  const searchDirs = ['apps/extension-spectra/src', ...PACKAGES.map(p => `${p}/src`)];

  function searchDir(dir) {
    if (!fs.existsSync(path.join(NEXUS_ROOT, dir))) return;
    const files = fs.readdirSync(path.join(NEXUS_ROOT, dir), { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        searchDir(fullPath);
      } else if (file.name.endsWith('.ts') && !fullPath.includes(excludeDir)) {
        const content = fs.readFileSync(path.join(NEXUS_ROOT, fullPath), 'utf-8');
        if (content.includes(symbol)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(symbol)) {
              refs.push({ file: fullPath, line: i + 1 });
            }
          }
        }
      }
    }
  }

  searchDirs.forEach(searchDir);
  return refs;
}

// 获取包的所有导出
function getPackageExports(pkgPath) {
  const indexPath = path.join(NEXUS_ROOT, pkgPath, 'src/index.ts');
  if (!fs.existsSync(indexPath)) return [];
  
  const exports = [];
  const content = fs.readFileSync(indexPath, 'utf-8');
  
  // 递归处理 export * from
  const reexports = content.matchAll(/export\s*\*\s*from\s*['"](.+?)['"]/g);
  for (const match of reexports) {
    let targetPath = match[1].replace(/\.js$/, '.ts');
    if (!targetPath.endsWith('.ts')) targetPath += '.ts';
    const fullPath = path.join(NEXUS_ROOT, pkgPath, 'src', targetPath);
    exports.push(...extractExports(fullPath));
  }
  
  exports.push(...extractExports(indexPath));
  return [...new Set(exports)];
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--refs')) {
    const symbolIndex = args.indexOf('--refs') + 1;
    const symbol = args[symbolIndex];
    if (!symbol) {
      console.log('用法: node check-exports.js --refs SYMBOL');
      process.exit(1);
    }
    
    console.log(`\n🔍 搜索 "${symbol}" 的引用...\n`);
    const refs = findReferences(symbol, '');
    if (refs.length === 0) {
      console.log('❌ 未找到引用');
    } else {
      console.log(`✅ 找到 ${refs.length} 处引用:\n`);
      refs.forEach(r => console.log(`  ${r.file}:${r.line}`));
    }
    return;
  }
  
  if (args.includes('--unused')) {
    console.log('\n🔍 检查未使用的导出...\n');
    let hasUnused = false;
    
    for (const pkg of PACKAGES) {
      const exports = getPackageExports(pkg);
      const pkgName = path.basename(pkg);
      
      for (const exp of exports) {
        const refs = findReferences(exp, pkg);
        if (refs.length === 0) {
          if (!hasUnused) console.log('⚠️  未使用的导出:\n');
          hasUnused = true;
          console.log(`  ${pkgName}: ${exp}`);
        }
      }
    }
    
    if (!hasUnused) {
      console.log('✅ 所有导出都有引用');
    }
    return;
  }
  
  // 默认：列出所有导出
  console.log('\n📦 NEXUS 包导出索引\n');
  
  for (const pkg of PACKAGES) {
    const exports = getPackageExports(pkg);
    const pkgName = `@nexus/${path.basename(pkg)}`;
    console.log(`${pkgName} (${exports.length} 个导出):`);
    exports.forEach(e => console.log(`  - ${e}`));
    console.log('');
  }
  
  console.log('用法:');
  console.log('  node check-exports.js --refs X  查找符号 X 的引用');
  console.log('  node check-exports.js --unused  检查未使用的导出\n');
}

main();
