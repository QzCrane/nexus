# 调试修复报告 (v2025-12-20)

**状态**: 已验证 ✅

## 修复项

- **UI 颜色**: 基于 `actualMode` 准确显示（Blue=Native, Purple=Capture）。
- **频谱渲染**: 动态 `getVizEnabled()` 实时响应设置变更。
- **日志标准**: 统一 `[SPECTRA]` 前缀过滤。

## 模块清单

- `shared/logger`: 统一日志。
- `content/policy-executor`: 模式调度核心。
- `content/capture-manager`: 劫持生命周期控制。

## 调试指引

- 控制台过滤: `[SPECTRA]`
- 模式日志: 关注 `Mode: xxx -> yyy` 转换。
