---
description: 任务完成交付前的门禁检查 (测试 + 文档同步)
---

# Feature Finish Workflow

任务交付前必须执行此流程，确保代码质量和文档同步。

## 1. 文档同步检查 (手动)

- [ ] 修改的模块 `.ai-context.md` 是否已同步？
- [ ] 新增的消息类型是否已更新到 `README.AI.md` 消息速查表？
- [ ] 新增依赖是否已记录到 `docs/dependencies/`？

## 2. 架构验证

// turbo

```bash
node nexus/scripts/verify-architecture.js
```

## 3. 构建检查

// turbo

```bash
cd nexus && pnpm build
```

## 4. E2E 测试 (Extension 相关修改必须)

// turbo

```bash
cd nexus/apps/extension-spectra && pnpm test:e2e
```

## 5. 最终检查清单

- [ ] 无 > 200 行的源码文件
- [ ] 无 > 30 行的 `.ai-context.md`
- [ ] 无硬编码的配置值
- [ ] 所有日志使用 `[SPECTRA]` 前缀
