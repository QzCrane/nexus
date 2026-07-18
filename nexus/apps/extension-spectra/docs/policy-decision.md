# 策略决策（入口索引）

SPECTRA 的控制策略、原生优先级、WebAudio/Capture 升降级与静态不变量统一由 [control-architecture.md](./control-architecture.md) 管理。

本文件不再维护独立决策矩阵，避免旧的整页 `BYPASS/WEBAUDIO/CAPTURE` 模式与逐字段 Capability Planner 发生漂移。

文档分工见 [`engineering-principles.md`](../../../docs/engineering-principles.md)：本页只保留入口，不复制规则、表格或实现状态。
