---
name: sync-nexus
description: 自动化同步 Nexus 私有库到 Public 开源库,保留 Git 历史。触发短语:"sync nexus", "push to public", "同步开源"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+, git 2.30+
metadata:
  category: release
  app: nexus
  phase: execute
  user-invocable: true
allowed-tools: Bash Read
---

# Sync Nexus → Public

同步 Nexus Monorepo → 开源仓库 (Spectra),保留 Git 历史。**脚本已经做 90% 的事,不要手动复制。**

## Trigger

当用户说 "sync nexus" / "push to public" / "同步开源" / "推到公网" 时自动加载。

## Process

### 1. 前置检查

- [ ] Nexus 仓库已提交推送(`git status` clean)
- [ ] `spectra-public` 文件夹与 `nexus` 同级存在
- [ ] 没有占用 `spectra-public` 的进程(IDE 打开的文件要保存)
- [ ] 确认本次提交信息已包含 release 描述

### 2. 执行同步脚本

```bash
bun run sync-spectra
```

> 在 `nexus/` 目录执行。

**脚本会自动完成**:

1. 运行 `verify-architecture` → 检测中文(error 级别)
   ↓ (失败则退出,不会同步)
2. 清理 public 目录(保留 `.git`)
3. 复制文件(应用 `excludePatterns` 列表)
4. 验证构建
5. `git commit`(复用 nexus 提交信息)
6. 打印 `git push` 命令(**不自动推**,等用户确认)

### 3. 推送 Public 仓库

```bash
cd ../spectra-public
git push origin main
```

### 4. 排除内容(只复制公开部分)

- `.agent/`、`docs/`、`scripts/`、`store-listings/`(内部配置)
- `.ai-context.md`、`plan.md`、`README.AI.md`(AI 内部文档)
- `apps/extension-halo/`(未发布,内部测试)
- `.gitnexus/`、`AGENTS.md`、`CLAUDE.md`(本地配置)

## Anti-Rationalization

- "我自己复制文件就行" → **错**。脚本会保留 Git 历史 + 跳过排除文件 + 跑 verify,手工会丢历史。
- "可以跳过 verify-architecture" → **错**。中文 error 会被开源审查看到,影响可信度。
- "可以自动 push" → **错**。push 是不可逆操作,必须人工确认。
- "排除列表我可以临时改" → **错**。改之前先在工程群里确认,避免泄露内部信息。

## Verification

- [ ] `sync-spectra` 退出码 0
- [ ] spectra-public 仓库有最新 commit
- [ ] spectra-public 仓库文件列表符合 `excludePatterns`
- [ ] 已手动 `git push origin main`
- [ ] GitHub 上可见同步内容
