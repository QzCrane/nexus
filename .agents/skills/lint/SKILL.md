---
name: lint
description: 路由到 NEXUS 当前代码、文档和工具链静态门禁，并解释真实 owner 失败。触发短语:"lint", "biome", "代码风格", "文档检查"。
---

# Lint

- Read the live package scripts and [`rules.md`](../../../rules.md); they own versions, targets, and strictness.
- Use the narrow owning lint during iteration and the applicable repository gate before delivery.
- Fix the source invariant; do not add broad suppression, stale baseline, generated-file edit, or unrelated formatting churn.
- A clean lint result does not replace behavior, browser, lifecycle, or production evidence.
