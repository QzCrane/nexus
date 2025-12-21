---
description: Extension Spectra 发布标准流程 (测试 + 打包)
---

# Spectra Release Workflow

发布 SPECTRA 扩展前的强制质量检查和打包流程。

## 1. 准备 (Preparation)

1. [ ] 确认当前代码已提交 (Clean Git State)。
2. [ ] 决定新版本号 (SemVer)，例如 `0.0.X`。

## 2. 版本同步 (Versioning)

1. [ ] 修改 `apps/extension-spectra/package.json` 中的 `version`。
2. [ ] 修改 `apps/extension-spectra/public/manifest.json` 中的 `version`。
   - **注意**：Chrome Extension 版本号只能包含数字 (e.g. 1.0.1)，不能有 '-beta' 等后缀。

## 3. 质量门禁 (Quality Gate) - 🔴 CRITICAL

发布前必须通过全链路测试。

// turbo
1. [ ] 运行冒烟测试：`cd apps/extension-spectra && pnpm test:e2e`
// turbo
2. [ ] 运行功能回归测试：`cd apps/extension-spectra && pnpm test:volume`

## 4. 构建与打包 (Build & Pack)

1. [ ] 生产构建：
   // turbo
   `cd apps/extension-spectra && pnpm build`
   
2. [ ] 验证 `dist/` 目录结构是否完整 (包含 manifest.json, background.js 等)。

3. [ ] 创建压缩包：
   - 目标：`apps/extension-spectra/releases/spectra-v<VERSION>.zip`
   - 内容：`dist/` 文件夹下的所有内容。

## 5. 交付 (Delivery)

1. [ ] 在这里简述本次更新的核心变更 (Changelog)。
