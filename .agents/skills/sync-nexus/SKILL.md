---
name: sync-nexus
description: 使用当前受审计生成器投影 public 候选，并保护目标仓库、隐私和授权边界。触发短语:"sync nexus", "push to public", "同步开源", "sync spectra", "sync halo"。
---

# Sync NEXUS

- Read [`rules.md`](../../../rules.md), the live sync generator, source candidate, and exact destination Git state.
- The generator owns filters, metadata, versions, validation, cleanup, and candidate creation; never hand-copy around it.
- Inspect the complete generated diff and prove no private/internal material escaped.
- Generation is not push authorization; report candidate and remote state separately.
