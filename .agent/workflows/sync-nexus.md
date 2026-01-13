---
description: 自动化同步 Nexus 私有库到 Public 开源库，并完成 Git 推送
---

# Sync Nexus to Public

同步 Nexus Monorepo → 开源仓库 (Spectra)，保留 Git 历史。

## 1. 前置检查

- [ ] 确保 Nexus 仓库已提交推送 (`git status` clean)
- [ ] 确保 `spectra-public` 文件夹与 `nexus` 同级存在
- [ ] 确保没有占用 `spectra-public` 的进程

## 2. 执行同步脚本

// turbo

```bash
bun run sync-spectra
```

(在 nexus 目录执行)

脚本会自动：

- 运行 verify-architecture → 检测中文 (error 级别)
  ↓ (失败则退出)
- 清理 public 目录 (保留 .git)
- 复制文件 (排除 excludePatterns)
- 验证构建
- git commit (复用 nexus 提交信息)
- 打印 git push 命令

## 3. 推送 Public 仓库

// turbo

```bash
cd ../spectra-public
git push origin main
```

## 4. 排除内容

- `.agent/`, `docs/`, `scripts/`, `store-listings/`
- `.ai-context.md`, `plan.md`, `README.AI.md`
- `apps/extension-halo/` (未发布)
