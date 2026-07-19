---
name: typecheck
description: 跑 TypeScript 类型检查(全 monorepo 或单 workspace)。触发短语:"typecheck", "ts check", "类型检查"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, TypeScript 5.3+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash
---

# TypeScript Typecheck

跑 `tsc --noEmit` 检查类型错误。**改完 .ts/.tsx 必跑。**

## Trigger

当用户说 "typecheck" / "ts check" / "类型检查" / "ts 报错了吗" 时自动加载。

## Process

### 1. 全 monorepo 检查

```bash
bun run typecheck
```

> 用 turbo 并行跑所有 workspace 的 typecheck。**日常用这个**。

### 2. 仅 Spectra 相关

```bash
bun run typecheck:spectra
```

> 只跑 contracts / kernel / audio-engine / extension-spectra,通常 10-15 秒。**Spectra 开发时用**。

## Anti-Rationalization

- "我只改了一行类型,不用跑" → **错**。typecheck 5 秒,debug 5 小时。
- "build 跑过了,typecheck 自动通过" → **错**。build 不一定严格类型检查(取决于 tsconfig)。
- "ts-ignore 一下,先跑过" → **错**。每个 ts-ignore 都是技术债,会在下次重构时爆炸。

## Verification

- [ ] typecheck 退出码 0
- [ ] 无 `any` 警告(项目规则禁止 `any`,必须用 `unknown` + 类型守卫)
