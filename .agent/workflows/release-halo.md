---
description: Extension Halo 发布标准流程 (测试 + 打包)
---

# Release Halo

Halo (SidePanel 工具箱) 发布流程。

## 1. 版本与日志

- [ ] 更新 `apps/extension-halo/package.json` 版本号
- [ ] 更新 `apps/extension-halo/src/manifest.json` 版本号
- [ ] 更新项目根目录 `CHANGELOG.md`

## 2. 依赖检查

Halo 依赖以下核心模块，确保它们是最新的：

- `@nexus/kernel` (RPC, Storage)
- `@nexus/ui-kit` (组件库)

## 3. 构建发布包

// turbo

```bash
# 1. 清理旧构建
bun run rimraf apps/extension-halo/dist

# 2. 生产环境构建 (压缩, 无 Sourcemap)
bun turbo run build --filter=@nexus/extension-halo

# 3. 打包 ZIP
cd apps/extension-halo
# (需安装 7-Zip 或使用类似命令)
7z a -tzip dist/halo-v$(jq -r .version package.json).zip dist/*
```

## 4. 验证清单 (Halo 特有)

- [ ] **SidePanel**: 确认点击图标能正确打开侧边栏
- [ ] **Permissions**: 检查 manifest 权限是否最小化 (Halo 应比 Spectra 更少)
- [ ] **Context**: 确保所有工具在无网络环境下可用 (离线优先)

## 5. 交付

- [ ] 提交代码: `feat(halo): release vX.Y.Z`
- [ ] 上传 ZIP 到 Chrome Web Store

## 6. 开源同步

发布后自动同步到公共仓库。

// turbo

```bash
bun run sync-halo
cd ../halo-public ; git push origin main
```
