---
description: 创建新模块/应用的标准流程 (自动化脚手架 + 文档注册)
---

# New Module

规范心跳，严禁“幽灵模块”。

## 1. 初始化

- `mkdir [packages|apps]/<name>` -> `bun init -y` (或 `npm init -y`)。
- `package.json`: `@nexus/<name>`, `type: "module"`。
- `tsconfig.json`: 继承 `../../tsconfig.base.json`。

## 2. 文档注册 (强制)

- [ ] **必须**创建 `.ai-context.md` (用途、职责、依赖)。
- [ ] 在 `nexus/README.AI.md` 架构图中登记。

## 3. 激活

// turbo

- `bun install` 更新 Workspace 链接。
  // turbo
- `bun run build` 验证构建。
