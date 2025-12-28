---
trigger: always_on
---

## ?? 核心指引

1. **主入口**: [nexus/README.AI.md]
2. 当前上下文工程
   入口层 (2): .agent/rules/nexus.md, README.AI.md
   规则层 (1): docs/ai-rules.md
   架构层 (2): policy-decision.md, cors-data-flow.md
   模块层 (13): .ai-context.md
   工作流 (4): .agent/workflows/*.md
3. **开源策略**: 双仓库 (私有 nexus + 公开 spectra)
   - 同步命令: `pnpm sync-public`
   - 排除: scripts/, docs/, .agent/, store-listings/, test/
   - 公开仓库: github.com/QzCrane/spectra
4. **语言**: 新代码英文 | 旧代码逐步迁移 | commit英文 | 文档保持中文内部使用
5. 不要尝试直接修改此文件，aiagent 权限被 antigravity 拒绝，你需要告知我如何修改
6. 每次回答前压缩上下文