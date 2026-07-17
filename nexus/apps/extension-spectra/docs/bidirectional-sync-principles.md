# 双向同步业务原则

网页、Popup、遥控与热键的唯一 writer、revision、真实 ACK 和回声关联规则统一由 [control-architecture.md](./control-architecture.md) 管理。

旧版 `settingByPlugin + 100ms` 时间窗和站点 API/DOM 双写不再是有效设计，不得作为实现依据。
