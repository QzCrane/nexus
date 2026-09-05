---
name: typecheck
description: 运行当前 TypeScript owner，并把错误追溯到契约、运行时 guard 与依赖方向。触发短语:"typecheck", "ts check", "类型检查", "ts 报错"。
---

# Typecheck

- Read live package scripts and compiler configuration; they own the compiler version and affected closure.
- Fix the first causal contract or resolution error before cascades.
- Prefer derived types and runtime guards over assertions, duplicated DTOs, optional-field widening, or suppressions.
- Type success does not validate storage, IPC, browser, network, or third-party data.
