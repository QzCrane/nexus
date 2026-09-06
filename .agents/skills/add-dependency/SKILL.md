---
name: add-dependency
description: 在手写通用能力之前及引入、替换或升级依赖时，先比较平台、现有库与成熟实现，核实 owner、成本和真实验证。触发短语:"add dependency", "install package", "upgrade package", "加依赖", "手写解析器", "复用选型", "通用算法"。
---

# Add dependency

Use this skill before choosing custom generic code as well as before changing a dependency. It is a decision prompt, not a second dependency policy.

- Read [`rules.md`](../../../rules.md), the [reuse decision owner](../../../nexus/docs/decisions/library-reuse.md), the [audit routing map](../../../nexus/reuse-remediation-map.json), live manifests, lockfile, owning code, and current package/release scripts.
- State the required semantics and actual runtime first. Compare native capability, a dependency already present, maintained specialist libraries, and custom implementation. A decision not to install a package still needs this comparison when implementing a generic engine.
- Preserve business authorization, document identity, physical completion, task cancellation, stored data and existing regression vectors. A parser or SDK does not own these contracts.
- Before adoption, verify the exact official release, license and notices, advisories, browser/CSP and renderer compatibility, transitive cost, and measured production-path impact. A preferred candidate is not already admitted.
- Keep one owner and one resolved version unless an unavoidable upstream constraint is evidenced. Define the old implementation's removal point; do not keep two same-purpose engines indefinitely or build an unnecessary plugin framework.
- An urgent minimal safety fix can precede library admission. Record why immediate replacement could not yet preserve the contract and when the temporary algorithm is retired; do not turn an emergency patch into an automatic long-term standard implementation.
- Validate through the repository's current focused and applicable gates, including existing negative vectors and actual generated entry paths. Never copy version numbers or command matrices into this skill. Report decisions, implementation, integration evidence and release certification separately.
