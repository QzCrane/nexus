---
trigger: always_on
---

# Project NEXUS AI 规则

## 🚨 必读入口

在 nexus/ 中工作时，必须先阅读：
1. nexus/README.AI.md - AI 唯一入口点

## 📖 阅读顺序

Level 1: nexus/README.AI.md
Level 2: nexus/packages/contracts/src/*.contracts.ts
Level 3: 目标模块的 .ai-context.md
Level 4: 仅在必要时读取实现代码

## 🔄 工作流 (Workflows)

不再记忆具体操作步骤，**必须**遵循以下标准工作流：
- **任务结束** -> `/feature-finish` (含文档同步检查)
- **新模块** -> `/new-module`
- **发版** -> `/release-spectra`
- **加依赖** -> `/add-dependency`

## ❌ 禁止事项

- 深层路径导入
- 在 contracts 中导入实现代码
- 修改公共 API 但不同步 contracts

## 📚 条件性阅读

| 情况 | 必须先读 |
|-----|---------|
| 修改架构/新增模块 | docs/ai-rules/architectural.md |
| 处理 API/密钥/权限 | docs/ai-rules/security.md |