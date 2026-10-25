---
type: reference
status: draft
audience: developer
owner: spectra-architecture-audit
last_reviewed: 2026-10-26
---

# SPECTRA 统一性与专业化审计 roadmap

> **非权威文档。** 本文只记录审计结论与待办排序。运行时行为、契约、生命周期与发布证据由 [Control architecture](../control/README.md)、[Runtime architecture](runtime.md)、[Runtime protocols](../reference/protocols.md)、[Remote-control security](../security/remote-control.md)、可执行契约、源码、测试、生产产物和发布门禁定义。本文任何结论与它们冲突时以它们为准。

## TL;DR

- 2026-10-25 复核：原蓝图 12 项主张中，4 项已失效（已落地或从未成立），8 项进入治理。
- 已落地：wire 单一 owner、控制源授权纯边界、audio-engine kebab-case 命名、`packages/contracts/src/messages/` 删除。
- 已治理（本轮）：i18n 三套 catalog 强类型单一源、`settings-repository` 领域拆分、`control-coordinator` 超策略拆分、remote 协议同构投影、QR 编码器替换、peerjs vendor 归位。
- 已治理（P7–P9）：`test/smoke/` 八个功能正交 Chrome 套件、Popup/Options theme-token 契约与原地 retry、vendored transport 发布证据。当前无剩余 roadmap 项。

## 1. 审计原则

1. **正交性**：一个模块只有一个变化原因，领域语义不混居。
2. **单一事实源**：每份业务状态只有一个权威写入者，其余为只读投影。
3. **显式生命周期**：Port、监听器、MediaStream、AudioContext 均有唯一属主与确定性处置。
4. **强契约**：通信消息、存储 Schema、i18n 键集合由编译期类型闭环。
5. **复用优先**：不手写已被工业界标准化并验证的通用算法。
6. **证据优先**：任何“死代码/无人引用”结论必须先给出引用点，否则不得作为删除依据。

## 2. 复核结论（2026-10-25）

| 原主张 | 复核结论 | 证据锚点 |
|---|---|---|
| 7 个 client 各自重复 `createRequestId()` 与封包 | **部分失效**：`createRequestId` 已只存在于 contracts；页面 client 全部经共享 transport。仍存在 5 个薄封装，属语义收敛而非协议重复。 | `packages/contracts/src/spectra.wire.ts`；`src/shared/transport.ts`；`src/shared/options-settings-client.ts` |
| `i18n-dict.ts`、`i18n-actions.ts` 无人引用，应删除 | **失效**：它们是构建期 i18n 资产的语义源，被生成器与选项页测试直接引用。删除会破坏 9 语言 × 3 surface 的资产契约。 | `scripts/i18n-assets.ts`；`test/options-copy.spec.ts` |
| `packages/contracts/src/messages/` 残留无引用定义 | **失效**：该目录已物理删除；仓库内仅存 `nexus-kernel/src/messages`（内核自有 owner）。 | [AI authoring hygiene §3.4](../../../../docs/principles/06-ai-authoring-hygiene.md)；`packages/nexus-kernel/src/index.ts` |
| audio-engine 用 PascalCase 文件名需改名 | **失效**：包已迁至 `packages/features/audio-engine` 且文件已为 kebab-case。 | `packages/features/audio-engine/src/audio-graph-router.ts`、`web-audio-controller.ts` |
| Remote 与扩展各写一份 HMAC/版本常量 | **成立（已治理）**：`REMOTE_PROTOCOL_VERSION` 与 Peer ID 形状由 `@nexus/contracts` 独占；静态页面删除版本字面量、payload、HMAC、base64url 与全部 wire 校验器，改为消费 `remote-site/dist/protocol.js` 生成投影。 | `packages/contracts/src/remote.contracts.ts`；`src/remote/protocol.ts`；`apps/extension-spectra/scripts/generate-remote-projection.ts`；`remote-site/app.js`；`scripts/verify/check-remote-projection.ts` |
| 手写 Reed-Solomon QR 编码器且限版本 1–10 | **失效（已治理）**：263 行自研编码器已删除；配对 URL 由已准入的 `qrcode` 编码，`qr-generator` 只保留 URL→data URL 的适配职责。 | `src/remote/qr-generator.ts`；`test/qr-generator.spec.ts`；`package.json` |
| `peerjs-loader.ts` 跨 5 层相对导入外部 vendor | **失效（已治理）**：transport 源移入扩展侧 `vendor/peerjs/`，静态页面只保留生成投影；导入不再逃出 `nexus/` 工作区。 | `src/offscreen-remote/peerjs-loader.ts`、`peerjs-vendor.ts`；`vendor/peerjs/`；`remote-site/vendor/`；`scripts/generate-remote-projection.ts` |
| `control-coordinator.ts` 上帝对象 | **成立（已治理）**：审计时 2744 行，超登记阈值 2600；现 2446 行，Popup 观察租约、invocation 身份与控制源授权已拆为独立 owner。 | `src/background/control-coordinator.ts`；`src/background/popup-visualizer-source.ts`；`src/background/extension-invocation.ts`；`src/background/control-source-authorization.ts`；`scripts/verify/file-length-policy.json` |
| `settings-repository.ts` 领域混杂 | **成立（已治理）**：审计时 1025 行且未登记；现 849 行，媒体路由投影与错误类型已独立。 | `src/background/settings-repository.ts`；`src/background/media-route-projection.ts`；`src/background/settings-errors.ts` |
| Dual-Runtime 仲裁状态机过度复杂 | **成立但受保护**：lean host 与 full runtime 的接管契约已由行为测试覆盖，不得以“简化”为名破坏 passive bootstrap 与租约归属。 | `src/content/input/lean-site-hotkey-host.ts`；`src/background/site-hotkey-transition.ts`；`test/runtime-loader.spec.ts` |
| `smoke.spec.ts` 7719 行单体测试 | **成立（已治理）**：原 7444 行单体拆为 `test/smoke/` 下 8 个功能正交套件（capture、feedback、hotkeys、page-media、popup-ui、remote-session、runtime-bootstrap、visualizer），共享只读 `harness.ts`；每个套件持有独立浏览器与临时 profile。 | `test/smoke/`；`scripts/browser-driver.ts` owner 校验 |
| i18n 值为 `Record<string, string>`、popup/options 与 `@nexus/ui-kit` 割裂 | **类型已治理；UI 收敛为 theme-token 契约**：三套 catalog 由 English 键 schema 与 `HotkeyAction` 契约约束；Popup/Options 是 vanilla DOM，`@nexus/ui-kit` 的 React 运行时不能进入 390px Action Popup，故收敛目标是主题契约而非组件复用。CSS `:root` / `[data-theme]` 是 live theme 唯一 owner；`src/shared/ui-colors.ts` 只拥有无法读取文档 CSS 的 content shadow root、canvas 与 SVG data URL 场景。 | `scripts/i18n-source-catalog.ts`；`public/popup.css`；`public/options.css`；`src/shared/ui-colors.ts`；`src/popup/constants/colors.ts` |

## 3. 待办 roadmap

排序原则：先消灭会导致**协议漂移或发布失败**的风险，再处理后端结构，最后处理测试与 UI 体验。

| 阶段 | 工作项 | 单一 owner 归宿 | 完成判据 | 状态 |
|---|---|---|---|---|
| P1 | Remote 协议同构 | `REMOTE_PROTOCOL_VERSION` 由 `@nexus/contracts` 独占；扩展 `src/remote/protocol.ts` 是唯一 wire 实现，经 `generate:remote-projection` 投影为 `remote-site/dist/protocol.js` | `remote-site` 不再含版本字面量与协议实现副本；投影陈旧性、脚本顺序与页面纯度为 verify 阻断项；双侧协议测试通过 | 完成 |
| P2 | QR 编码器替换 | 使用成熟 `qrcode` 实现，删除自研 RS/矩阵代码 | 容量边界不再抛 `RangeError`；配对端到端可扫码；无新增打包预算超标 | 完成 |
| P3 | vendor 导入归位 | 扩展侧 `vendor/peerjs/` 是 transport 源、声明与 MIT 许可的唯一 owner；`remote-site/vendor/` 由同一生成器投影，禁止跨 5 层相对导入 | `peerjs-loader` / `peerjs-vendor` 不再使用逃逸路径；三份投影字节与 owner 一致；构建产物一致 | 完成 |
| P4 | `control-coordinator` 分解 | 引入 typed control-source sub-owner（`extension-invocation`、`popup-visualizer-source`），revision writer 仍在 coordinator | 行数回到登记阈值内；授权矩阵与 revision 兼容测试不减少；verify 警告清零 | 完成 |
| P5 | `settings-repository` 拆分 | 拆出媒体路由投影与设置错误类型两个 owner，revision/CAS 留在仓储入口 | 每个 owner 单一变化原因；默认行数策略内；迁移与并发测试全绿 | 完成 |
| P6 | i18n 强类型 | 以 `en-US` 为键 schema 的唯一源，三套 surface catalog 收敛到 `scripts/i18n-source-catalog.ts`，生成器继续产出 gzip 资产 | 编译期拦截缺失/多余键；9 语言 × 3 surface 资产字节契约不变 | 完成 |
| P7 | `smoke.spec.ts` 解耦 | 按功能正交拆为 `test/smoke/` 下的独立套件，共享只读 harness，逐套件独立浏览器、临时 profile 与确定性资源释放 | 单文件回到可维护规模；用例数与覆盖不下降；串行污染消失 | 完成 |
| P8 | UI 与样式收敛 | Popup/Options 为 vanilla DOM，收敛目标是 theme-token 契约：CSS `:root` / `[data-theme]` 是 live theme 唯一 owner，`ui-colors.ts` 只服务无法读取文档 CSS 的 shadow root、canvas 与 SVG 场景 | 无 `window.location.reload()` 兜底；样式可主题化；视觉回归通过 | 完成 |
| P9 | Vendored transport 发布证据 | `source-derived-third-party.json` 增加 `spectra` owner，`public/THIRD_PARTY_NOTICES.txt` 随扩展发布；生产产物门禁从该注册表派生 release-evidence 集合 | 本地 marker、上游 repository/commit、许可证与 notice markers 均由 `check:governance` 校验；缺任一项阻断；未登记的孤儿产物仍按 unreachable 阻断 | 完成 |

P7 拆分证据（2026-10-26）：`bun run test:smoke` 运行 8 个文件、47 个用例、456 个断言，0 失败（76.31s）；`run-tests.ts` 从默认单测矩阵排除 `smoke/`，`test:chrome` 仍是 `build:dev && test:smoke`。原始单体 45 个 `test()` 声明在拆分后一一对应（`page-media` 的两条 `%s` 参数化用例使实际执行数为 47），覆盖未下降。

### 已完成项的执行证据

| 阶段 | 证据 |
|---|---|
| P1 | `remote-site/app.js` 零 wire 实现，仅解构 `globalThis.SpectraRemoteProtocol`；投影由 `bun run generate:remote-projection` 生成并由 `verify` 字节级校验；`remote-security` 21 项、`release-tooling` 38 项通过 |
| P2 | `qr-encoder.ts` 已删除；`qr-generator.ts` 仅调用 `qrcode` 的 `toString({ type: 'svg' })`；`qr-generator.spec.ts` 用 jsQR 解码真实配对 URL 与 380+ 字节 payload；`qrcode` 进入 24.6 KiB 惰性 chunk，`popup.js` 入口字节不变 |
| P3 | `vendor/peerjs/{peerjs.min.js,peerjs.min.d.ts,LICENSE.peerjs}` 是唯一 owner；`remote-site/vendor/` 由 `generate:remote-projection` 生成，`verify` 的 `REMOTE-VENDOR-001` 逐字节阻断陈旧；`peerjs-data-only` 2 项、`remote-security` 21 项通过 |
| P4 | `control-coordinator.ts` 2446 行（阈值 2600）；`extension-invocation.ts` 拥有 invocation 身份与文档绑定；`popup-visualizer-source.ts` 借用 coordinator 的 `serialized` 队列与 snapshot 投影，不另建 revision writer；`control-source-authorization.ts` 拥有 source-by-sender 判定；`verify` 0 error / 0 warning |
| P5 | `settings-repository.ts` 849 行（默认 1000）；`media-route-projection.ts` 拥有媒体路由归一化与读投影；`settings-errors.ts` 拥有错误类型；settings/preset 行为测试 35 项通过 |
| P6 | `OptionsI18nKey` 由 `DICT_EN` 推导；actions 字典由 `HotkeyAction` 约束；`i18n-assets.ts` 只做编码，组合收敛到 `i18n-source-catalog.ts`；i18n/UI/options-copy 契约测试 18 项通过 |
| P7 | `test/smoke/` 8 个套件、47 用例、456 断言全绿（76.31s）；每个套件以自身路径作为 `launchPuppeteerBrowser` 的 owner literal；`test:visual` 3 个场景通过 |
| P8 | Popup/Options retry 均原地重跑：`disposePopupAttempt()` 释放 attempt 后重入 `main()`，Options 以模块级 disposer 与幂等 listener guard 重入 `startOptions()`；`src/` 内 `location.reload` 零命中；`popup.css` / `options.css` 的全部字面色值只存在于 `:root` 与 `[data-theme]` token 定义；`popupPrimaryColor()` 按当前 theme 缓存 live token；`test:unit` 110/110、`test:visual` 1/1（含 8 个断言）通过 |
| P9 | `source-derived-third-party.json` 的 `spectra` owner 登记 `vendor/peerjs` 的上游 repository/commit/license；`public/THIRD_PARTY_NOTICES.txt` 含本地 marker；`check-source-derived-third-party.spec.ts` 5 项通过，`check:governance` 报告 `2 exact owner(s)`；`check-production-artifacts.ts` 的 `releaseEvidenceArtifacts()` 以该注册表为唯一 owner 派生 reachability 豁免，`build` 报告 `86/87 reachable, 1 registered release notice(s)`，`release-tooling.spec.ts` 39 项通过（含「registered notices pass while unregistered orphans fail」） |

## 4. 不得触碰的既有约束

- 控制提交的 revision 唯一写入者与 source-by-sender 授权矩阵不可拆分到两个模块。
- `runtime-loader`、`site-hotkey-transition`、Capture 准入与租约归属由行为测试锁定，重构不得降低覆盖。
- i18n 生成契约（9 语言、surface 分区、delta 编码、`VALUE_MARKER`、gzip `mtime: 0`）是发布资产的一部分，变更必须同步 `test/i18n-assets.spec.ts`。
- 任何“无人引用”结论必须附引用点或依赖图证据，否则不得删除。
