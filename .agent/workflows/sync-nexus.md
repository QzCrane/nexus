---
description: 自动化同步 Nexus 私有库到 Public 开源库，并完成 Git 推送
---

# Sync Nexus to Public

用于将 Nexus Monorepo 的变更同步到开源仓库 (Spectra)，处理文件过滤、Commit Squash 和自动推送。

## 1. 前置检查

- [ ] 确保 Nexus 仓库已提交 (git status clean)
- [ ] 确保 `spectra-public` 文件夹与 `nexus` 同级存在
- [ ] 确保没有占用 `spectra-public` 的进程 (如 VSCode 终端、Turbo 守护进程)

## 2. 执行同步脚本

// turbo

```bash
# 停止可能占用文件的后台进程
taskkill /F /IM turbo.exe 2>$null

# 运行同步脚本 (清理 public -> 复制文件 -> 修正配置 -> 验证构建)
node scripts/sync-to-public.cjs
```

(在 nexus 目录执行)

## 3. 推送 Public 仓库

// turbo

```bash
cd ../spectra-public
git status
# 注意: sync 脚本通常已经完成了 commit (Squash)
# 这里只需确认并推送
git push -f origin main
```

## 4. 验证

- [ ] 访问 GitHub 确认提交已更新
- [ ] 检查 CI/CD 状态 (如果有)
