# 依赖库与工作流

**环境**: pnpm workspace

## 核心依赖

- `chrome-types`: 提供 `chrome.*` 命名空间类型。

## 常用命令

- `pnpm install`: 安装依赖。
- `pnpm build`: 全量构建。
- `pnpm --filter [name] build`: 单包构建。

## 引用规则

引用内部包需使用 `"@nexus/[name]": "workspace:*"`。
