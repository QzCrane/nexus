---
name: new-module
description: 创建新模块/应用的标准流程(脚手架 + 文档注册 + 验证)。触发短语:"new module", "create app", "scaffold", "建模块"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Write Edit
---

# New Module

规范心跳,严禁"幽灵模块"。**没注册 = 不存在。**

## Trigger

当用户说 "new module" / "create app" / "scaffold" / "建模块" / "新应用" 时自动加载。

## Process

### 1. 初始化(脚手架)

```bash
# 创建目录
mkdir [packages|apps]/<name>

# 初始化 package.json(必须是 @nexus/<name> 命名空间)
cd [packages|apps]/<name> ; bun init -y
```

随后**手动**编辑 `package.json`:

- `name`: `@nexus/<name>`(必须)
- `type`: `"module"`(必须)
- `private`: `true`(默认)
- `description`: 一句话用途

随后**手动**创建 `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json"
}
```

### 2. 文档注册(强制,不可跳过)

- [ ] **必须**创建 `.ai-context.md`(用途、职责、依赖、红线)
- [ ] 在 `nexus/README.AI.md` 架构图中登记
- [ ] 在 `nexus/docs/ai-rules.md` 依赖清单中登记(如适用)
- [ ] 在 `nexus/package.json` workspaces 中确认 glob 覆盖

### 3. 激活与验证

```bash
# 1. 更新 workspace 链接
bun install

# 2. 验证构建(确认脚手架可用)
bun run build
```

> 必须在 `nexus/` 根目录执行。

## Anti-Rationalization

- "先不写 .ai-context.md,以后补" → **错**。没有 .ai-context.md 的模块对 AI 是黑盒,半年后没人知道它干嘛的。
- "我随便起个名字就行" → **错**。必须 `@nexus/<name>` 命名空间,否则 monorepo 链接会出问题。
- "我不用 type=module" → **错**。根 `package.json` 是 `"type": "module"`,子包必须一致。
- "workspace 链接不需要,bun 自己能识别" → **错**。需要 `bun install` 触发链接重建。

## Verification

- [ ] 目录已创建,`package.json` 配置正确
- [ ] `tsconfig.json` 继承基础配置
- [ ] `.ai-context.md` 已创建
- [ ] `README.AI.md` 架构图已更新
- [ ] `bun run build` 通过
- [ ] `bun install` 链接已建立(其他 workspace 可以 `import` 它)
