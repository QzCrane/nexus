# NEXUS 实施方案

## 三驾马车

**SPECTRA**(媒体/Popup) + **CORTEX**(AI/SidePanel) + **HALO**(工具/SidePanel)

---

## 快速抢占计划 (2026 Q1)

### 🎯 顶替目标 (有问题的头部扩展)

| 周次 | 目标扩展         | 痛点               | 顶替方案             |    插件    |
| :--: | ---------------- | ------------------ | -------------------- | :--------: |
| W1-2 | Dark Reader      | 拖慢/崩溃/配置复杂 | 轻量 CSS 注入+白名单 |    HALO    |
| W3-4 | Video Speed Ctrl | 仅速率/无 EQ/UI 陋 | 速率+音频一体        | SPECTRA ✅ |
| W5-6 | OneTab/Toby      | 付费墙/停更        | 免费+AI 搜索标签     |    HALO    |
| W7-8 | Lightshot        | 上传服务器/单一    | 本地保存+批注        |    HALO    |

### ⚡ 冲刺路线

```text
W1-2: HALO v0.1 深色模式 (顶替 Dark Reader)
      ├─ 轻量CSS反色 (非DOM遍历)
      ├─ 一键开关 + 站点白名单
      └─ 性能: <50ms 加载

W3-4: SPECTRA v1.1 审核通过 + 小迭代
      ├─ SponsorBlock 集成 (P2)
      └─ YouTube UI简化

W5-6: HALO v0.2 标签管理 + 截图
      ├─ 标签分组 + 一键保存/恢复
      ├─ AI模糊搜索标签
      └─ 截图 + 本地批注

W7-8: CORTEX v0.1 听歌识曲
      ├─ ACRCloud API
      └─ 三插件联动基础
```

---

## 功能矩阵 (精简版)

### SPECTRA v1.0 ✅ 已提交审核

| 模块   | 功能                           | 状态 |
| ------ | ------------------------------ | :--: |
| Audio  | 800%/EQ/压限/声道/延迟         |  ✅  |
| Video  | 速率 16x/旋转/镜像/画中画/截图 |  ✅  |
| Tool   | AB 循环/时间标记/背景暗化      |  ✅  |
| Remote | 手机遥控 QR+WebRTC             |  ✅  |

### SPECTRA 后续

|  P  | 功能                 | 交付 |
| :-: | -------------------- | :--: |
|  1  | 人声分离 (WASM+ONNX) |  Q1  |
|  1  | 标签页直播共享       |  Q2  |
|  2  | SponsorBlock 跳过    |  W3  |
|  2  | 字幕下载             |  Q2  |

### HALO (新建)

|  P  | 功能             | 交付 |
| :-: | ---------------- | :--: |
|  1  | 深色模式         |  W2  |
|  1  | 二维码生成/扫描  |  W4  |
|  1  | 丝滑滚动         |  W4  |
|  2  | 标签分组+AI 搜索 |  W6  |
|  2  | 截图+本地批注    |  W6  |
|  2  | 剪贴板历史       |  W8  |
|  3  | 网站时间限制     |  Q2  |

### CORTEX (新建)

|  P  | 功能                | 交付 |
| :-: | ------------------- | :--: |
|  1  | 听歌识曲            |  W8  |
|  1  | AI 摘要 (本地 ONNX) |  Q2  |
|  2  | 双语字幕            |  Q2  |
|  2  | OCR                 |  Q3  |

---

## 开源策略 (双仓库)

```text
nexus/ (私有)  ──pnpm sync-public──→  nexus-public/ → github.com/QzCrane/spectra
```

### 仓库配置

| 仓库            | 用途     | 可见性  | 内容         |
| --------------- | -------- | :-----: | ------------ |
| QzCrane/nexus   | 开发备份 | Private | 完整+AI 工程 |
| QzCrane/spectra | 开源发布 | Public  | 干净代码     |

### 同步排除

| 排除项                | 原因        |
| --------------------- | ----------- |
| scripts/              | AI 工程脚本 |
| docs/                 | 内部文档    |
| .agent/               | 工作流      |
| store-listings/       | 商店描述    |
| test/                 | 测试代码    |
| \*.ai-context.md      | 上下文      |
| plan.md, README.AI.md | 内部计划    |

### 命令

```bash
pnpm sync-public              # 同步到nexus-public
cd ../nexus-public && git push  # 推送到GitHub
```

---

## 英文迁移

| 类别   | 策略                        |
| ------ | --------------------------- |
| 新代码 | **强制英文注释**            |
| 旧代码 | 逐步迁移 (168 文件/1748 处) |
| commit | 英文                        |
| 文档   | 内部中文,公开英文           |
| 检测   | `pnpm verify` 自动统计      |

---

## 架构

```text
Apps: SPECTRA ←→ CORTEX ←→ HALO
         ↓          ↓         ↓
Pkgs: audio-engine|ai-engine|zen-engine
         ↓
Kernel: RPC Bus + Storage + Cross-Ext
         ↓
Infra: rust-core (WASM)
```

---

## 护城河

```text
L4 生态 │ 三插件互通 + NEXUS Bus
L3 AI   │ 本地ONNX (无云依赖)
L2 性能 │ WASM + AudioWorklet
L1 信任 │ 开源 + 零遥测
L0 功能 │ 800%+EQ+速率+遥控 ✅
```

---

## 市场洞察 (2025.12)

### 头部痛点 → 机会

| 扩展        | 痛点        | 我们         |
| ----------- | ----------- | ------------ |
| Dark Reader | 慢/崩溃     | HALO 轻量    |
| OneTab      | 付费/停更   | HALO 免费    |
| GPT Wrapper | 69%隐私风险 | CORTEX 本地  |
| Video Speed | 仅速率      | SPECTRA 全能 |

### 用户挫败 TOP3

| 痛点     |    频次    | 对策            |
| -------- | :--------: | --------------- |
| 性能拖累 | ⭐⭐⭐⭐⭐ | WASM+按需激活   |
| MV3 迁移 | ⭐⭐⭐⭐⭐ | 原生 MV3 无遗留 |
| 虚假评价 |  ⭐⭐⭐⭐  | 开源可审计      |

### 2025 安全事件

- Phantom Shuttle 窃取 170+站密码
- Trust Wallet 恶意版本窃$7M
- 30+扩展账户被劫持注入恶意更新
- AI 扩展窃取 ChatGPT/Claude 对话

→ **启示**: 开源+零遥测+最小权限

---

## 长线 (2026)

| 季度 | 重点    | 交付                      |
| :--: | ------- | ------------------------- |
|  Q1  | 抢占    | HALO 深色+标签+截图       |
|  Q2  | AI 壁垒 | 人声分离+听歌识曲+AI 摘要 |
|  Q3  | 付费    | PRO 订阅体系              |
|  Q4  | 生态    | 移动 APP+云同步           |
