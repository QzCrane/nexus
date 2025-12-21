---
description: 引入新依赖库的标准流程 (查重 + 记录)
---

# Add Dependency Workflow

在 pnpm monorepo 中添加依赖时的规范，防止重复和滥用。

## 1. 查重 (Check for Duplicates)

1. [ ] 阅读 `nexus/docs/dependencies/README.md`。
2. [ ] 检查是否已存在同类库 (例如：已有 `lodash` 就不要加 `underscore`；已有 `dayjs` 就不要加 `moment`)。
3. [ ] 如果是通用库，考虑是否应先安装在 Root 依赖中，还是特定 Workspace。

## 2. 安装 (Installation)

1. [ ] 执行安装命令：
   - Root: `pnpm add -w <package>`
   - Workspace: `pnpm add <package> --filter <workspace>`

// turbo
2. [ ] 验证安装：`pnpm install`

## 3. 记录 (Documentation) - 🔴 CRITICAL

1. [ ] 打开 `nexus/docs/dependencies/README.md`。
2. [ ] 在相应的分类下（或新增分类）添加该库的条目。
3. [ ] 格式：
   ```markdown
   | 依赖库 | 版本 | 用途 | 引入日期 |
   |-------|-----|------|---------|
   | <name> | <ver> | [必须简述为什么要引入它] | YYYY-MM-DD |
   ```

## 4. 类型检查 (Type Check)

1. [ ] 如果是 JS 库，检查是否需要 `@types/<name>`。
2. [ ] 运行 `pnpm typecheck` 确保没有破坏类型系统。
