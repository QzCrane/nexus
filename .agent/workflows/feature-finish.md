---
description: 任务交付门禁 (测试 + 文档同步 + 提交)
---

# Feature Finish

交付前必检，确认质量与文档对齐。

## 1. 上下文工程更新

- [ ] 模块 `.ai-context.md`
- [ ] `README.AI.md` 消息速查表，模块索引等
- [ ] 依赖及规则 (`docs/ai-rules.md`)
- [ ] 更新所有相关 .md
- [ ] 告知用户如何更新 `nexus.md`

## 2. 自动化验证

// turbo

```bash
bun run build
```

(在 nexus 目录执行)

## 3. 最终清单 (审计)

- [ ] 符合 verify-architecture 各项规则
- [ ] 警告数无增长
- [ ] 文档信息熵极高 (无损压缩)

## 4. 提交和推送

// turbo-all

```bash
git add -A ; git commit -m "feat: <简述功能>" ; git push
```

(在 nexus 目录执行)

## 注意

- 步骤 1 需手动确认
- 步骤 2-4 可使用 turbo 自动执行
- 提交信息遵循 Conventional Commits
- PowerShell 不支持 `&&`，每条命令单独执行，或使用 ; 分隔
