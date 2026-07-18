# SPECTRA 回归恢复报告

**日期**: 2026-07-18  
**基线**: `c7f6d82` (feat(spectra): complete MV3 runtime overhaul and release)  
**当前**: `1678041` (fix(halo): resolve critical memory leaks and race conditions)

## 重构概述

从 `c7f6d82` 到 `1678041`，SPECTRA 进行了 7 次提交的重构，核心目标是统一 native-first 控制架构。

**变更规模**: 190 files changed, 25596 insertions(+), 5472 deletions(-)

> **历史报告说明**：下方问题单保留 2026-07-18 的原始复现、根因假设和
> 基线字段。原始字段只表示当日快照，不代表当前主分支状态。
> 当前已落地的实现、所有权和约束以 [control-architecture.md](./control-architecture.md)、
> [protocols.md](./protocols.md)、[architecture.md](./architecture.md) 和
> [development-sync-2026-07-19.md](./development-sync-2026-07-19.md) 为准。

## 当前验证与落地状态（2026-07-19）

本节覆盖旧问题单的当前结果，避免历史字段被误读为未完成工作：

| 历史问题 | 当前实现/owner | 当前状态 |
| --- | --- | --- |
| 音量滚轮跳回 | `ControlCoordinator` + `NativeMediaExecutor` 的实际事件/getter ACK | 已关闭；单元与 smoke 覆盖 |
| 网页调整后插件音量失效 | 页面观察提交与唯一 native writer | 已关闭；页面事件不会吞掉后续插件控制 |
| PiP 运行时状态 | `trusted-activation-bridge`、`activeVideo` 与 native 生命周期 | 已落地；成功以浏览器实际 getter/event 为准，不支持站点返回结构化错误 |
| 播放切换 readback 不匹配 | 稳定事件窗口、双边界 getter 和 generation/revision 校验 | 已关闭；失败字段独立回滚 |
| 网站图标缺失 | 支持的 favicon URL/页面声明图标与边界错误处理 | 已落地；不依赖 `_favicon` 权限 |
| 按钮 `undefined` | canonical locale keys、英文 fallback 与 UI contract 检查 | 已关闭；顶部、选项卡、reset/状态按钮纳入覆盖 |
| 设置/遥控器打不开 | Popup facade、remote renderer 与 v2 消息校验 | 已关闭；认证和 URL 错误可观察 |
| 动态频谱失效 | active processor subscriber lease、单 in-flight batch、15 Hz 上限 | 已落地；无 active processor 时保持零资源 |

同时纳入本轮同步的历史回归包括：冷文档快捷键 READY ensure、长按
Toast 取消与跨标签焦点提示、媒体指纹单 route 缓存、Capture lazy
activation、站点倍速 one-shot bridge、PiP/fullscreen 音频 baseline handoff、
QR image URL 校验及 `no-controllable-origin`/READY timeout 的结构化错误。

截至本节日期，当前主分支验证结果为：unit **371 passed**、smoke **23
passed**、typecheck/lint/build 通过。报告末尾的 **345/21** 数字仅是旧基线
快照。

## 已知回归问题

### 问题 1: 音量滚轮跳回

**现象**: 用户在 popup 中使用滚轮调节音量时，滑块会跳回之前的值  
**复现步骤**: 
1. 打开 popup
2. 使用滚轮调节音量
3. 观察滑块跳回

**预期**: 滑块停留在用户调节的位置  
**实际**: 滑块跳回之前的值  
**根因**: 待调查（涉及 handleMediaEvent 中的 ownership 机制）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 2: 插件音量控制失效（网页调整后）

**现象**: 网页自身调整音量后，插件的音量控制失效  
**复现步骤**: 
1. 使用插件设置音量
2. 网页自身调整音量（如视频播放器控件）
3. 尝试再次使用插件调节音量

**预期**: 插件仍能控制音量  
**实际**: 插件控制失效  
**根因**: 待调查（涉及 nativeMediaOwnership 的 relinquish 逻辑）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 3: PiP 运行时状态问题

**现象**: Picture-in-Picture 状态显示不正确  
**复现步骤**: 
1. 点击 PiP 按钮
2. 观察 PiP 状态

**预期**: PiP 状态正确反映实际状态  
**实际**: 状态显示不正确  
**根因**: 待调查（涉及 trusted-activation-bridge 的 userActivation 检查）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 4: 播放切换 readback 不匹配

**现象**: 播放/暂停切换后，UI 显示的状态与实际不一致  
**复现步骤**: 
1. 点击播放/暂停按钮
2. 观察 UI 状态

**预期**: UI 状态与实际播放状态一致  
**实际**: 状态不匹配  
**根因**: 待调查（涉及 writeWithStableEventAck 的 retry 逻辑）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 5: 网站图标缺失

**现象**: popup 中不显示网站的 favicon  
**复现步骤**: 
1. 打开 popup
2. 观察网站图标区域

**预期**: 显示当前网站的 favicon  
**实际**: 图标缺失  
**根因**: 待调查（涉及 dom-init.ts 的 favicon 加载逻辑）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 6: 按钮 undefined

**现象**: 某些按钮显示 "undefined" 文本  
**复现步骤**: 
1. 打开 popup
2. 观察按钮文本

**预期**: 按钮显示正确的文本  
**实际**: 显示 "undefined"  
**根因**: 待调查（涉及 i18n-apply.ts 的文本应用逻辑）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 7: 设置/遥控器打不开

**现象**: 点击设置或遥控器按钮无响应  
**复现步骤**: 
1. 打开 popup
2. 点击设置或遥控器按钮

**预期**: 打开设置面板或遥控器  
**实际**: 无响应  
**根因**: 待调查（涉及 popup/index.ts 的初始化流程）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

### 问题 8: 音频动态条失效

**现象**: 音频可视化动态条不显示或不更新  
**复现步骤**: 
1. 播放音频
2. 观察动态条

**预期**: 动态条随音频更新  
**实际**: 不显示或不更新  
**根因**: 待调查（涉及 visualizer/loop.ts 的 isProcessorActive 检查）  
**修复 commit（历史基线）**: 当日未记录；当前实现见上方状态表
**测试文件（历史基线）**: 当日未记录；当前覆盖见开发同步文档
**最终状态（历史基线）**: 当日未验证；当前状态见上方状态表

---

## 恢复计划

按照 `spectra.md` 规范的 8 个阶段逐步实施：

1. ✅ **阶段 0**: 建立可复现基线（已完成）
2. **阶段 1**: Runtime identity 与 READY
3. **阶段 2**: Snapshot authority
4. **阶段 3**: 媒体选择与 replay
5. **阶段 4**: PiP 与 trusted activation
6. **阶段 5**: Popup transaction manager
7. **阶段 6**: Runtime cache 与更新
8. **阶段 7**: 兼容层清理

## 测试覆盖矩阵

| 场景 | 当前覆盖 | 需要新增 |
|------|---------|---------|
| Popup 首次打开 | ✅ smoke | 需加强 identity bind 验证 |
| Runtime 慢初始化 | ❌ | 需新增 |
| Runtime 初始化失败 | ❌ | 需新增 |
| 页面改音量后重开 popup | ❌ | 需新增 |
| Snapshot view 后改无关字段 | ❌ | 需新增 |
| 新广告视频插入 | ❌ | 需新增 |
| Restore 写非活动媒体 | ❌ | 需新增 |
| Extension-owned ratechange | ❌ | 需新增 |
| Cold volume read 失败 | ❌ | 需新增 |
| 多字段同时操作 | ❌ | 需新增 |
| PiP native 成功、commit 失败 | ❌ | 需新增 |
| Service worker restart | ✅ smoke | 需加强 |
| Runtime 自行 dispose | ❌ | 需新增 |
| SPA same-document navigation | ✅ smoke | 需加强 |
| Full navigation | ✅ smoke | 需加强 |
| Extension update | ✅ smoke | 需加强 |

## 基线测试快照（历史）

- **单元测试**: 345 pass, 0 fail, 3241 expect() calls（2026-07-18）
- **Smoke 测试**: 21 pass, 0 fail, 149 expect() calls（2026-07-18）
- **构建**: 成功，67/67 artifacts（2026-07-18）

## 原始下一步计划（历史）

开始**阶段 1: Runtime identity 与 READY**，优先修改：
- `src/background/runtime-loader.ts`
- `src/content/core/index.ts`
- `src/content/core/bootstrap.ts`
- `src/shared/content-runtime.ts`
- `packages/contracts/src/spectra.content-runtime.ts`
