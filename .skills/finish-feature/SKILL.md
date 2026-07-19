---
name: finish-feature
description: 任务交付门禁(verify + build + commit + push)。触发短语:"finish feature", "ship it", "end task", "完工"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+, git 2.30+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep
---

# Finish Feature

交付前必检,确认质量与文档对齐。**慢是为了不必返工。**

## Trigger

当用户说 "finish feature" / "ship it" / "end task" / "交付" / "完工" 时自动加载。

## Process

### 1. 上下文工程更新

- [ ] 模块级 `.ai-context.md`(工具/功能/红线/依赖变化)
- [ ] `README.AI.md` 消息速查表、模块索引
- [ ] `docs/ai-rules.md` 依赖清单、规则
- [ ] 所有相关 `.md` 文档
- [ ] 告知用户更新 `nexus.md`(AI 无权直接改)

### 2. 自动化验证(全量质量门)

```bash
bun run verify:q
```

> `verify:q` 已经包含 build 校验(typecheck + 跨模块依赖 + 中文错误检测),**不要**单独跑 `bun run build` —— 重复且更慢。

### 3. 最终清单(审计)

- [ ] verify-architecture 各项规则通过
- [ ] 警告数无增长(对比 `verify:v` 输出)
- [ ] 文档信息熵极高(无损压缩,无冗余)

### 4. 提交与推送

```bash
git add -A ; git commit -m "feat: <简述功能>" ; git push
```

> 必须在 `nexus/` 目录执行(根 `package.json` 在那里)。
> 提交信息遵循 Conventional Commits(`feat` / `fix` / `refactor` / `chore` 等)。

## Anti-Rationalization

- "我改的是 trivial 改动,不用走 verify" → **错**。`finish-feature` 的存在就是为了给 trivial 改动也上护栏。
- "build 很慢,跳过" → **错**。`verify:q` 已经优化为快速模式,直接跑。
- "typecheck 已经在 prebuild 跑过了" → **错**。`verify:q` 跑的是**全量** typecheck,不是单模块。
- "我先 push,等会再补 commit message" → **错**。一次性写好,避免半成品进 git。

## Verification

- [ ] `bun run verify:q` 退出码 0
- [ ] git status clean
- [ ] git log 显示新 commit 已推送
- [ ] 文档已同步(无过期引用)

## PowerShell 注意事项

- PowerShell 不支持 `&&`,每条命令单独执行,或用 `;` 分隔
- 文件路径用 `\`,URL 用 `/`
