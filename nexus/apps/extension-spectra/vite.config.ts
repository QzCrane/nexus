import { defineConfig } from 'vite';

// 简化配置：只复制 public 目录到 dist
// 所有原始 JS 文件保持不变
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 不构建任何 JS，只复制 public 目录
    rollupOptions: {
      input: {},
      output: {
        format: 'es'
      }
    }
  },
  publicDir: 'public'
});
