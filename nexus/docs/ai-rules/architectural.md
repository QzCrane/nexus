# 架构约束

**核心原则**: 单向依赖，层级清晰。

## 依赖链

`Contracts (Types) ← Kernel (IPC) ← Audio-Engine (Logic) ← Spectra (App)`

## 导入规范

- **禁止**: 深层路径导入、循环依赖、底层引用上层实现。
- **允许**: 仅通过包入口（Entry Points）导出。

## 职责定位

- **Contracts**: 纯接口定义，禁止任何逻辑。
- **Kernel**: RPC、存储中转，禁止业务实现。
- **Audio-Engine**: WebAudio 链路，禁止 UI 与 Chrome 插件 API。
- **Spectra**: UI 交互与 Chrome API 调度。

## 策略禁令

- **禁止**: 硬编码 URL 路径、规则表。
- **依据**: 仅由 WebAudio 行为检测判断级别。
