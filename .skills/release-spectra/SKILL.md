---
name: release-spectra
description: Extension Spectra 发布标准流程(版本 + 质量门 + 打包 + 验证 + 同步)。触发短语:"release spectra", "spectra 发布"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+, Chrome Web Store access
metadata:
  category: release
  app: spectra
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Glob
---

# Release Spectra

Spectra (音视频增强扩展) 发布流程。**质量门禁是死命令,不能跳。**

## Trigger

当用户说 "release spectra" / "spectra 发布" / "spectra 上架" 时自动加载。

## Process

### 0. 提交与推送前置

- [ ] 确认所有改动已 `git add && git commit && git push`(release-spectra 前必须干净)
- [ ] 确认 CI 通过(如有)

### 1. 版本控制

- [ ] 递增 `apps/extension-spectra/package.json` 版本号(SemVer:`MAJOR.MINOR.PATCH`)
- [ ] 当前版本(参考): `1.4.0`

### 2. 质量门禁(全跑,不可跳)

```bash
# 生产模式构建(去除 sourcemap, 最小化)
bun run --cwd apps/extension-spectra build:prod

# 端到端测试
bun run --cwd apps/extension-spectra test:e2e
```

### 3. 构建打包

```bash
# 打包 ZIP(PowerShell)
Compress-Archive -Path .\apps\extension-spectra\dist\* -DestinationPath .\spectra-v<VER>.zip -Force
```

> 验证 zip 大小应 < 1MB(无冗余资源文件)。

### 4. 商店素材

- `_locales/`: 9 语言扩展国际化(manifest 引用)
- `store-listings/`: 9 语言商店详细描述
- 宣传图 + 截图: 手动准备(`apps/extension-spectra/store-listings/screenshots/`)

### 5. 交付

- [ ] 提交信息简述 Changelog(`feat(spectra): release vX.Y.Z`)
- [ ] 上传至 Chrome Developer Dashboard
- [ ] 填写商店信息(从 `store-listings/` 复制)
- [ ] 等待 Chrome 审核(通常 1-3 个工作日)

### 6. 开源同步

```bash
bun run sync-spectra
cd ../spectra-public ; git push origin main
```

## Anti-Rationalization

- "test:e2e 太慢,跳过" → **错**。Spectra 涉及音视频管道,e2e 是唯一的真实测试。
- "zip 大小无所谓" → **错**。Spectra 目标 < 1MB,超出说明有冗余。
- "可以本地手动测就行,不用 e2e" → **错**。手动测试不可重现,CI 才是回归保护。
- "spectra-public 同步可以等下周" → **错**。public 仓库是用户接触的第一界面,延迟会让用户拿到过期版本。

## Verification

- [ ] zip 文件已生成,大小 < 1MB
- [ ] `package.json` 版本号递增
- [ ] CHANGELOG.md 已更新
- [ ] test:e2e 全通过
- [ ] spectra-public 已同步推送
- [ ] Chrome Web Store 已提交审核
