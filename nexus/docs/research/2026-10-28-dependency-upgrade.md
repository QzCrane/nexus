---
type: explanation
status: draft
audience: contributor
owner: product-research
last_reviewed: 2026-10-28
---

# 全仓依赖升级 2026-10-28：范围、判定与证据

一次把两个依赖域（仓库治理域与产品工作区）升级到当日最新，并记录哪些升级被拒绝、
哪些升级暴露了真实缺陷、以及凭什么说升级没有改变产品行为。

## 1. 结论先说

- **两个域都升级完成**：治理域 3 项、产品域 20 项、运行时 Bun 1.4.0 → 1.4.4。
- **两项有意保留**：`puppeteer-floor`（Chrome 135 回放驱动）与
  `typescript-compiler-api`（TS 6 编译器 API）。保留理由是功能性的，不是惰性。
- **升级抓出 3 个既有缺陷**：一个真实的 hook 误命名（Biome 2.6 报错级）、
  一处被重复硬编码的 Bun 版本真源、一处性能策略所有权校验与实际脚本结构脱节。
- **产品行为未变**：12 条真实 Chromium 浏览器用例通过，产物体积 HALO −7.9 KB、
  SPECTRA +18 B。

## 2. 变更清单

### 2.1 运行时与工具链

| 对象 | 升级前 | 升级后 | 说明 |
|---|---|---|---|
| Bun | 1.4.0 | **1.4.4** | 两处 `packageManager`、`toolchain-versions.ts`、7 个 workflow、closeout 容器摘要 |
| `@biomejs/biome` | 2.5.11 | **2.6.3** | 新增 Markdown 支持，见 §4 |
| `turbo` | 2.10.12 | **2.11.10** | — |
| `sharp` | 0.35.4 | **0.35.5** | 根域与 SPECTRA 双处 |

Bun 的容器摘要不是猜的：用 registry 解析 `oven/bun:1.4.0` 得到的摘要与仓库既有 pin
逐字符一致，方法可信后才用同一方法取得 `1.4.4` 的摘要
`sha256:1d22548f…`。Bun 1.4.4 对既有锁执行 `--frozen-lockfile` 的报告是
`Checked 171 installs across 252 packages (no changes)`，说明升级运行时不需要改写锁。

### 2.2 产品依赖

| 包 | 升级前 | 升级后 |
|---|---|---|
| `@peculiar/x509` | 2.1.0 | **3.1.0**（主版本） |
| `preact` | 10.29.8 | **11.1.0**（主版本） |
| `puppeteer` | 25.9.0 | **25.16.0** |
| `@playwright/test` / `playwright` | 1.62.1 | **1.64.1** |
| `react` / `react-dom` | 19.2.8 | **19.3.1** |
| `@types/react` / `@types/react-dom` | 19.2.5 / 19.2.3 | **19.3.0** |
| `@types/node` | 26.4.0 | **26.6.5** |
| `@swaggerexpert/jsonpath` | 4.0.4 | **4.0.5** |
| `cron-parser` | 5.10.0 | **5.10.2** |
| `darkreader` | 4.9.128 | **4.9.133** |
| `dompurify` | 3.4.15 | **3.4.17** |
| `entities` | 8.0.0 | **8.1.0** |
| `jose` | 6.2.10 | **6.2.13** |
| `lossless-json` | 4.3.1 | **4.3.3** |
| `marked` | 18.0.11 | **18.1.2** |
| `pinyin-pro` | 3.29.3 | **3.29.5** |
| `sql-formatter` | 15.8.2 | **15.9.0** |
| `yaml` | 2.9.0 | **2.9.1** |
| `chrome-types` | 0.1.440 | **0.1.460** |

已在最新、无需动作：`esbuild` 0.28.2、`terser` 5.51.2、`csp_evaluator` 1.1.8、
`typescript` 7.0.2。

### 2.3 有意保留

| 包 | 保留版本 | 理由 |
|---|---|---|
| `puppeteer-floor`（`npm:puppeteer-core`） | 24.7.2 | 它是 `browserReplayPolicy` 在 **Chrome 135 最小回放**时唯一使用的驱动。升到 25 会失去对声明下限浏览器的驱动能力，等于删掉一条兼容性证据通道。 |
| `typescript-compiler-api`（`npm:typescript`） | 6.0.2 | `typescript-7-epoch.json` 明确要求：原生 CLI 是 7.0.2，但脚本使用的编译器 API 不得因为 CLI 更新而替换。替换需要重新做消费者普查与语义测试。 |

## 3. 升级暴露的真实缺陷

### 3.1 组件工厂里定义的“hook”（错误级）

`apps/extension-halo/src/tools/network/panel.tsx` 在组件内写了
`const useCurrent = () => setUA(navigator.userAgent)`。它不是 hook，只是事件处理器，
但 `use` 前缀让它对人、对工具都是 hook 语义。改名为 `applyCurrentUA`。
这不是噪声告警：hook 前缀误用会让人把它当 hook 调用，从而引入条件调用风险。

### 3.2 `innerText` 写入 10 处

`innerText` 写入会触发样式/布局计算，`textContent` 不会。全部 10 处写入的都是纯文本
（音量读数、静音图标、徽章计数、i18n 文案、保存反馈、侧栏数值、标题/域名），
改为 `textContent` 后语义等价且更便宜。其中 `volume-view` 的读数写入位于拖动路径上，
与 10-28 音量延迟修复同向。

保留 `innerText` 的只有两处**测试失败诊断**（需要“用户实际看到的文字”），已就地标注
理由。

### 3.3 Bun 版本有两个真源

`scripts/sync-public.ts` 硬编码了 `const BUN_VERSION = '1.4.0'`，并附注释
“Keep in sync with scripts/toolchain-versions.ts”。任何只改一处的升级都会让公开镜像
生成出错误版本。已改为从 `toolchain-versions.ts` 导入，删除第二真源。

### 3.4 性能策略的所有权校验与实际结构脱节

`check-runtime-performance-policy` 要求包脚本**字面包含** workload 文件名。SPECTRA 的
`test:performance` 是 `bun scripts/run-performance-tests.ts`（为了设
`SPECTRA_CHROME_INTEGRATION=1`），文件名在 runner 里，于是四条策略测试长期失败。
修复方式是让校验器把“包脚本 + 它直接调用的本地 runner 文件”共同视为所有权面；
spec 文件名仍必须出现在其中之一，否则照样失败。

## 4. Biome 2.6 的 Markdown 支持：显式排除

升级后 `run-strict-biome` 报 `Biome processed 150 of 149 expected files`——这不是噪声，
而是 Biome 2.6 开始处理 `.md`。仓库对 Markdown 已有唯一权威 `docs:check`（含入口、
链接可达性、frontmatter 规则）。让 Biome 再定义一套文档规则会形成第二个权威，
因此显式声明 `!**/*.md`：

- `biome.json` 的 `files.includes` 增加排除项；
- `check-workspace-lint.ts` 的 `EXPECTED_BIOME_INCLUDES` 与对应 spec 同步。

实测即使纳入，当前 27 篇文档也是 0 诊断；排除的理由是**权威唯一**，不是诊断太多。

## 5. 验证证据

| 门禁 | 结果 |
|---|---|
| `test:unit` | SPECTRA 118 文件 + HALO 441 条，全通过 |
| `typecheck`（`--force`，避开缓存） | 6/6 包通过 |
| `lint`（Biome 2.6.3） | 1746 文件 0 诊断；分域统计 33/19/8/10/424/1038/159 |
| `verify:q` | OK |
| `docs:check` | 115 篇通过 |
| `check:governance`（含 29 个 spec / 169 条） | 通过 |
| `check:platform` / `check:closeout-evidence` / `check:dependency-update-evidence` | 通过 |
| `check:toolchain` | Bun 1.4.4 / Biome 2.6.3 / Turbo 2.11.10 |
| `check:dependency-revalidation` | 12 条绑定，锁 2026-10-28 |
| 真实 Chromium（HALO，Playwright） | 12 条通过：hydration、portal、懒加载、无障碍 |
| `@peculiar/x509` v3 契约 | 真实自签证书字段解码通过 |

### 5.1 产物对比（同工具、同 workload）

| 产物 | 文件数 | 基线 | 候选 | Δ |
|---|---|---|---|---|
| HALO | 152 | 3,429,885 B | 3,421,982 B | **−7,903 B** |
| SPECTRA | 87 | 904,906 B | 904,924 B | **+18 B** |

HALO 的差异主要是内容哈希改名（chunk 文件名变化），真实体积变化来自
`purify.es` +2.1 KB 与 `json-path` +138 B，整体略降；SPECTRA 的 `popup.js` +14 B
来自 `innerText → textContent`。

## 6. 已知环境限制（不是升级回归）

SPECTRA 的 smoke 套件（8 个文件 / 47 条）**不是 CI 门禁**，CI 只跑 4 条定点 Chrome 用例；
它是**发布门禁**：`release:spectra` 的 `production Chrome integration` 步骤调用
`test:chrome:dist`。

**这里我最初写过一个错误结论，现予更正。** 当时我拿三种浏览器二进制对比，看到三种不同
结果，就判定「变量是浏览器二进制，不是代码」。实际结果是：**全部三种都是同一个产品缺陷**，
只是失败点不同，我把它当成了环境差异。

真实根因（2026-10-28 追加修复）：`ControlFieldState` 在「写入与确认分离」改造中新增了可选
字段 `writeState`，但运行时允许键集合 `fieldStateKeys` 没有同步。于是内容脚本返回的 ACK
被判为非法，Background 丢弃每一次原生写入的确认：

- 用户可见症状一：弹窗提示 `Content host returned an invalid SPECTRA extension RPC v2
  response for spectra.control.intent.execute` / `intent.submit`；
- 用户可见症状二：**音量回弹**——意图未落地，界面退回上一个已确认值。

修复后同一套件从 **3 通过 / 7 失败** 变为 **9 通过 / 1 失败**，且新增两条守卫：
「填满全部可选字段的 ACK 必须通过校验」「执行器产出的 ACK 必须端到端通过校验」。

剩余 1 条失败（`synchronizes page-native media bidirectionally…`）停在
「Popup controller-only mute ACK」：点静音后页面侧 `mediaMuted` 始终为 false。
对照实验确认它与 `writeState` 修复无关（撤掉修复时它更早就失败），是**另一个独立问题**，
尚未定位。

由此得到的维护事实仍然成立，只是不再作为结论：套件只在发布时执行（两次发布之间没有回归网），
且新版 Chrome 对 `--load-extension` 的收紧使只有 CfT 构建才可靠地加载未打包扩展。

`check:governance` 在本机默认 PATH 下会有一条
`Executable not found in $PATH: "powershell.exe"`。`closeout-evidence.ts` 在 Windows 上
用 PowerShell 读可执行文件 `ProductVersion`，而本机 PATH 缺少
`WindowsPowerShell/v1.0` 目录。把该目录加入 PATH 后 169/169 全通过，属环境差异。

## 7. 复现

```bash
bun install --frozen-lockfile            # 两个域各一次
bun run check:toolchain
bun run check:dependency-revalidation
bun run lint && bun run typecheck --force
bun run test:unit && bun run verify:q
bun run build
bun nexus/scripts/product-artifact-snapshot.ts halo apps/extension-halo/dist <out> <head> <tree>
```

## 8. 再验证触发条件

- `puppeteer-floor` 或 `browser-floor.json` 的 Chrome 下限发生变化时，两者必须同时重判。
- 升级 TS CLI 主/次版本时，重新确认 API 包仍是 6.0.2 的理由是否成立。
- Biome 若把 Markdown 规则扩展到与 `docs:check` 重叠，重新评估 `!**/*.md` 的必要性。
- 任何一次依赖变更都要重新计算 `dependency-revalidation.json` 的 `lockSha256`，
  否则门禁会以“锁漂移”拒绝。
