---
name: release-halo
description: Extension Halo 发布标准流程(版本 + 依赖检查 + 打包 + 验证 + 同步)。触发短语:"release halo", "halo 发布"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+, Chrome Web Store access
metadata:
  category: release
  app: halo
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Glob
---

# Release Halo

Halo (SidePanel 工具箱) 发布流程。**离线优先,权限最小化。**

## Trigger

当用户说 "release halo" / "halo 发布" / "halo 上架" 时自动加载。

## Process

### 1. 版本与日志

- [ ] 递增 `apps/extension-halo/package.json` 版本号(SemVer)
- [ ] 同步 `apps/extension-halo/src/manifest.json` 版本号
- [ ] 更新项目根 `CHANGELOG.md`(添加新版本条目)

### 2. 依赖检查

Halo 依赖以下核心模块,**确认它们已是最新**:

- `@nexus/kernel`(RPC + Storage)
- `@nexus/ui-kit`(组件库)
- `@nexus/contracts`(类型契约)

### 3. 构建发布包

```bash
# 1. 清理旧构建
Remove-Item -Recurse -Force apps/extension-halo/dist -ErrorAction SilentlyContinue

# 2. 生产环境构建(压缩 + 无 Sourcemap)
bun run --cwd apps/extension-halo build:prod

# 3. 打包 ZIP(PowerShell Compress-Archive,与 release-spectra 风格一致)
Compress-Archive -Path .\apps\extension-halo\dist\* -DestinationPath .\halo-v<VER>.zip -Force
```

> 验证 zip 大小应合理(< 5MB,无冗余资源)。

### 4. 验证清单(Halo 特有)

- [ ] **SidePanel**: 点击工具栏图标能正确打开侧边栏
- [ ] **Permissions**: 检查 manifest 权限是否最小化(Halo 应比 Spectra 更少 —— 不需要 video 权限)
- [ ] **Offline**: 所有工具在无网络环境下可用(离线优先)
- [ ] **DarkReader**: 暗色模式应用不冲突
- [ ] **Cross-browser**: Chrome / Edge / Brave 都能正常加载

### 5. 交付

- [ ] 提交代码: `feat(halo): release vX.Y.Z`
- [ ] 上传 `halo-vX.Y.Z.zip` 到 Chrome Web Store
- [ ] 填写商店素材(截图、宣传语)

### 6. 开源同步

```bash
bun run sync-halo
cd ../halo-public ; git push origin main
```

## Anti-Rationalization

- "Halo 没有视频功能,不用检查 video 权限" → **对**,但要确认 manifest 里也没有声明。
- "打包大小无所谓" → **错**。Chrome Web Store 对 > 50MB 警告。
- "可以跳过离线测试" → **错**。Halo 定位是离线工具箱,网络依赖就是 bug。

## Verification

- [ ] zip 文件已生成,大小 < 5MB
- [ ] CHANGELOG.md 已更新
- [ ] git tag 已创建(或在 commit message 中标注版本)
- [ ] halo-public 已同步
