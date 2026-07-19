---
name: verify
description: 运行架构校验脚本(verify-architecture)。触发短语:"verify", "check architecture", "架构校验"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash
---

# Verify Architecture

跑 `verify-architecture.js`,检查跨模块依赖 + 中文检测 + 类型一致性。**改完代码必跑。**

## Trigger

当用户说 "verify" / "check architecture" / "架构校验" / "verify 一下" 时自动加载。

## Process

### 1. 快速模式(默认)

```bash
bun run verify:q
```

> `verify:q` 是快速模式,只检查关键规则,通常 5-10 秒。**日常开发用这个**。

### 2. 详细模式(发布前)

```bash
bun run verify:v
```

> `verify:v` 是详细模式,跑全量规则 + 警告,通常 30-60 秒。**发布前 / PR 提交前用**。

## 它检查什么

- 跨模块依赖合规(workspace 引用是否正确)
- 中文检测(error 级别会卡同步到 public 仓库)
- 类型契约一致性(contracts 包 vs 实现)
- 死代码扫描
- 重复依赖检测
- 文件命名规范

## Anti-Rationalization

- "我只改了一个文件,不用跑" → **错**。一个文件可能跨模块被引用,验证一下 5 秒。
- "build 跑过了就行" → **错**。build 不检查中文、不检查跨模块契约。
- "verify:v 太慢,跳过" → **错**。发布前必须跑详细模式。

## Verification

- [ ] `verify:q` 退出码 0
- [ ] 警告数与上次对比无增长
