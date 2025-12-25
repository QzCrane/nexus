---
description: Extension Spectra 发布标准流程 (测试 + 打包)
---

# Spectra Release

发布前强制质量门禁。

## 1. 版本控制

- 同步修改 `package.json` 和 `manifest.json` 的版本号 (SemVer)。

## 2. 质量门禁 (强制)

// turbo

- 冒烟测试: `pnpm test:e2e`
  // turbo
- 功能回归: `pnpm test:volume`

## 3. 构建打包

// turbo

- `pnpm build` -> 验证 `dist/` 完整性。
- 压缩 `dist/` 至 `releases/spectra-v<VER>.zip`。

## 4. 交付

- 在提交信息中简述 Changelog。
