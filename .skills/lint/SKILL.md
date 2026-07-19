---
name: lint
description: 跑 Biome 代码风格检查(全 monorepo)。触发短语:"lint", "biome", "代码风格"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read
---

# Lint (Biome)

跑 `@biomejs/biome` 检查代码风格 + 错误。**项目用 Biome 不用 ESLint,别搞错。**

## Trigger

当用户说 "lint" / "biome" / "代码风格" / "lint 一下" 时自动加载。

## Process

### 1. 全 monorepo 检查

```bash
bun run lint
```

> 跑 contracts / kernel / audio-engine / extension-spectra + workspace fallback 检查。

### 2. 仅 Spectra

```bash
bun run --cwd apps/extension-spectra lint
```

> 跑 Spectra 自己的 lint(`biome check src test public build.mjs scripts`)。

## 它检查什么

- 缩进/引号/分号风格
- 死代码
- 不安全模式(`any`、未处理的 Promise 等)
- 导入顺序
- 未使用的变量

## Anti-Rationalization

- "biome --write 自动修就行" → **可以**,但必须 review diff,不要盲信。
- "我用了 prettier 配的格式" → **错**。项目用 Biome,格式规则可能不同。
- "这个警告是 false positive,biome-disable 一下" → **最后手段**。每个 disable 都要加注释说明。

## Verification

- [ ] lint 退出码 0
- [ ] 无新增 warning(对比 git diff)
