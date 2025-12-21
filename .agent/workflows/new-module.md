---
description: 创建新模块/应用的标准流程 (自动化脚手架 + 文档注册)
---

# New Module Creation Workflow

在创建新的 Package 或 App 时，必须严格执行此流程，以防止"幽灵模块"产生。

## 1. 规划 (Planning)

- [ ] 确定模块类型：
    - `packages/contracts/`: 纯类型定义
    - `packages/features/`: 核心业务逻辑
    - `packages/`: 通用工具库
    - `apps/`: 可部署应用

## 2. 初始化 (Scaffolding)

1. [ ] 创建目录：`mkdir packages/<name>` 或 `apps/<name>`
2. [ ] 初始化：进入目录运行 `npm init -y`
3. [ ] 修改 `package.json`: 
    - name: `@nexus/<name>`
    - type: "module" (必须)
4. [ ] 创建 `tsconfig.json` 并继承基类：
    ```json
    { "extends": "../../tsconfig.base.json", "include": ["src"] }
    ```

## 3. 文档 (Context) - 🔴 CRITICAL

不要跳过此步！

1. [ ] **创建 `.ai-context.md`** (该文件是 AI 理解模块的唯一途径)，模板如下：
    ```markdown
    # Module Name

    **用途**：[一句话描述]

    ## 核心职责
    - [职责1]
    - [职责2]

    ## 依赖关系
    - 外部依赖：...
    - 被依赖：...
    ```

## 4. 注册 (Registration)

1. [ ] 打开 `nexus/README.AI.md`。
2. [ ] 在 directory tree 图表中添加新模块的路径。
3. [ ] 简要注释其用途。

## 5. 验证 (Verify)

// turbo
1. [ ] 运行 `pnpm install` 更新 Workspace 链接。
// turbo
2. [ ] 运行 `pnpm build` (如果适用) 确保配置无误。
