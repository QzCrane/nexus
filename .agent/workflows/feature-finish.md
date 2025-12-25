---
description: 任务交付门禁 (测试 + 文档同步)
---

# Feature Finish

交付前必检，确认质量与文档对齐。

## 1. 文档同步 (手动)

- [ ] 模块 `.ai-context.md` 已更新。
- [ ] 消息速查表 (`README.AI.md`) 已同步。
- [ ] 依赖记录 (`docs/dependencies/`) 已登记。

## 2. 自动化验证

// turbo

```bash
node nexus/scripts/verify-architecture.js
cd nexus && pnpm build
cd apps/extension-spectra && pnpm test:e2e
```

## 3. 最终清单 (审计)

- [ ] 源码 ≤ 200 行；`.ai-context.md` ≤ 30 行。
- [ ] 无硬编码，日志统一 `[SPECTRA]` 前缀。
- [ ] 确保文档信息熵极高（无损压缩）。
