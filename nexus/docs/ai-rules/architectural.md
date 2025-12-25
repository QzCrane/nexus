# 架构约束

**核心**: 单向依赖，层级清晰。

## 依赖链

Contracts ← Kernel ← Audio-Engine ← Spectra

## 导入规范

允许: 包入口导出 / 上层引用下层
禁止: 深层路径导入 / 循环依赖 / 底层引用上层

## 职责

- Contracts: 接口定义，禁止任何逻辑
- Kernel: RPC+存储中转，禁止业务实现
- Audio-Engine: WebAudio 链路，禁止 UI/Chrome API
- Spectra: UI+Chrome 调度

## 策略禁令

- 禁止: 硬编码 URL/规则表
- 依据: 仅 WebAudio 行为判断
