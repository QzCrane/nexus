---
description: Extension Spectra 发布标准流程 (测试 + 打包)
---

# Spectra Release

发布前强制质量门禁。

## 0. 提交、推送

## 1. 版本控制

- 同步递增版本号 (SemVer):
  - `apps/extension-spectra/package.json`
  - `apps/extension-spectra/public/manifest.json`

## 2. 质量门禁

// turbo

```bash
# 确保使用生产模式构建 (去除 sourcemap, 最小化)
cd nexus ; bun turbo run build:prod --filter=@nexus/extension-spectra
cd apps/extension-spectra ; bun run test:e2e
```

## 3. 构建打包

// turbo

```bash
cd nexus/apps/extension-spectra
Compress-Archive -Path .\dist\* -DestinationPath .\spectra-v<VER>.zip -Force
```

验证 zip 大小应 <1MB (无冗余资源文件)。

## 4. 商店素材

- `_locales/`: 9 语言扩展国际化 (manifest 引用)
- `store-listings/`: 9 语言商店详细描述
- 宣传图 + 截图: 手动准备

## 5. 交付

- 提交信息简述 Changelog
- 上传至 Chrome Developer Dashboard
- 填写商店信息 (从 store-listings 复制)

## 6. 开源同步

发布后自动同步到公共仓库。

// turbo

```bash
bun run sync-spectra
cd ../spectra-public ; git push origin main
```
