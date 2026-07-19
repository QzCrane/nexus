---
type: reference
status: archived
audience: contributor
---

# SPECTRA 历史快照归档 (2026-Q3)

历史 release 证据。**非当前 owner**——所有行为规范由 [control-architecture.md](../control-architecture.md)、[protocols.md](../protocols.md)、[architecture.md](../architecture.md)、[cors-data-flow.md](../cors-data-flow.md)、[remote-security.md](../remote-security.md) 唯一拥有。

## 归档文件

| 文件 | 日期 | 角色 |
|---|---|---|
| [regression-recovery-2026-07-18.md](./regression-recovery-2026-07-18.md) | 2026-07-18 | c7f6d82 → 1678041 重构基线，7 个 commit 25596+ / 5472- |
| [optimization-review-2026-07-15.md](./optimization-review-2026-07-15.md) | 2026-07-15 | v1.3.4 发布证据 (558,770 B) SHA-256 验证 |
| [optimization-review-2026-07-17.md](./optimization-review-2026-07-17.md) | 2026-07-17 | native-first 控制重构后发布证据 |
| [development-sync-2026-07-19.md](./development-sync-2026-07-19.md) | 2026-07-19 | 当前主分支相对 07-18 基线的实现同步 |

## 引用规则

- 历史快照不参与决策，只作为发布/回归证据。
- 当前实现、所有权和约束以上述 5 份 owner 文档为准。
- 引用历史快照时同时引用对应 owner；不得单独以历史快照定义行为。

## 归档时机

- 单次发布/重构完成后 30 天自动归档。
- 新一轮发布/重构开始时由 `lint-docs.mjs` 检查 owner 文档。
