---
description: 引入新依赖库的标准流程 (查重 + 记录)
---

# Add Dependency

防止 Monorepo 依赖滥用。

## 1. 查重

- [ ] 检查 `nexus/docs/ai-rules.md` 依赖清单。
- [ ] 严禁引入已存在同类库 (如已有 `lodash` 严禁加 `underscore`)。

## 2. 安装

- Root: `pnpm add -w <pkg>`
- Workspace: `pnpm add <pkg> --filter <ws>`
  // turbo
- 验证: `pnpm install`

## 3. 记录 (强制)

- [ ] 更新 `nexus/docs/ai-rules.md` 依赖清单表格。
- [ ] 日志格式: `| 库名 | 版本 | 精炼用途 | 日期 |`

## 4. 类型与检查

- [ ] 必要时安装 `@types/<pkg>`。
- [ ] 运行 `pnpm typecheck` 验证。
