/**
 * SPECTRA Build Script
 * 
 * 分别构建 background、content、popup 为 IIFE 格式
 */

import { build } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { cpSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = resolve(__dirname, 'dist');
const publicDir = resolve(__dirname, 'public');

// 清理 dist 目录
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

// 1. 复制 public 目录（包含 manifest/icon 等静态文件）
cpSync(publicDir, distDir, { recursive: true });
console.log('✓ Copied public files');

// 通用构建配置
const commonResolve = {
  alias: {
    '@nexus/contracts': resolve(__dirname, '../../packages/contracts/dist/index.js'),
    '@nexus/kernel': resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
    '@nexus/audio-engine': resolve(__dirname, '../../packages/features/audio-engine/dist/index.js')
  }
};

// 构建函数 - 使用 Rollup 输出
async function buildEntry(entry, outputName, globalName) {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false, // 不自动写入，手动控制
      lib: {
        entry: resolve(__dirname, entry),
        name: globalName,
        formats: ['iife']
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: `${outputName}.js`
        }
      },
      minify: false,
      sourcemap: 'inline'
    },
    resolve: commonResolve
  });

  // result 可能是数组 (多入口) 或单个对象
  const outputs = Array.isArray(result) ? result : [result];
  
  for (const bundle of outputs) {
    if (bundle && bundle.output) {
      for (const chunk of bundle.output) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          const outputPath = resolve(distDir, `${outputName}.js`);
          writeFileSync(outputPath, chunk.code);
          console.log(`✓ Built ${outputName}.js (${(chunk.code.length / 1024).toFixed(2)} KB)`);
          return;
        }
      }
    }
  }
  console.error(`✗ Failed to build ${outputName}.js - no entry chunk found`);
}

// 2. 构建 background.js
await buildEntry('src/background/index.ts', 'background', 'SpectraBackground');

// 3. 构建 content.js
await buildEntry('src/content/index.ts', 'content', 'SpectraContent');

// 4. 构建 popup.js
await buildEntry('src/popup/index.ts', 'popup', 'SpectraPopup');

// 5. 构建 offscreen.js
await buildEntry('src/offscreen/index.ts', 'offscreen', 'SpectraOffscreen');

// 6. 构建 offscreen-remote.js (PeerJS WebRTC)
await buildEntry('src/offscreen-remote/index.ts', 'offscreen-remote', 'SpectraOffscreenRemote');

console.log('\n🎉 Build complete! Output: apps/extension-spectra/dist');

