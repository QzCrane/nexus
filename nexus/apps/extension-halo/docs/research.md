# HALO 功能调研报告

## 调研日期: 2025-12-30

---

# 一、PDF 工具箱调研

## 1. 功能矩阵

| 功能              | 优先级 | 技术方案         | 依赖  | 体积   |
| ----------------- | ------ | ---------------- | ----- | ------ |
| **合并 PDF**      | P0     | pdf-lib          | 纯 JS | ~300KB |
| **拆分 PDF**      | P0     | pdf-lib          | 纯 JS | 已含   |
| **删除/提取页面** | P0     | pdf-lib          | 纯 JS | 已含   |
| **旋转页面**      | P1     | pdf-lib          | 纯 JS | 已含   |
| **页面重排序**    | P1     | pdf-lib + DnD    | 纯 JS | ~20KB  |
| **压缩 PDF**      | P2     | Ghostscript WASM | WASM  | ~5MB   |
| **PDF→ 图片**     | P2     | pdf.js + canvas  | 纯 JS | ~500KB |
| **图片 →PDF**     | P2     | pdf-lib          | 纯 JS | 已含   |
| **PDF 预览**      | P1     | pdf.js           | 纯 JS | ~500KB |
| **填写表单**      | P3     | pdf-lib          | 纯 JS | 已含   |
| **添加水印**      | P3     | pdf-lib          | 纯 JS | 已含   |

## 2. 技术选型

### 核心库 (本地处理)

| 库                   | 用途           | 体积   | 特点               |
| -------------------- | -------------- | ------ | ------------------ |
| **pdf-lib**          | 合并/拆分/编辑 | ~300KB | 纯 JS, 无依赖, MIT |
| **pdf.js**           | 渲染/预览      | ~500KB | Mozilla, 成熟      |
| **Ghostscript WASM** | 压缩/格式转换  | ~5MB   | 高质量压缩         |

### 架构建议

```text
modules/pdf/
├── core.ts          # API 封装
├── merge.ts         # 合并逻辑
├── split.ts         # 拆分逻辑
├── compress.ts      # 压缩 (WASM)
├── preview.ts       # pdf.js 预览
├── panel.tsx        # UI
├── types.ts         # 类型
└── wasm/            # WASM 模块 (按需加载)
```

### 按需加载策略

```ts
// 基础功能 (~300KB) - 随扩展安装
const pdfLib = await import("pdf-lib");

// 压缩功能 (~5MB) - 首次使用时下载
const compressWasm = await loadWasmModule("ghostscript");
```

## 3. 隐私优势

| 竞品              | 处理方式   | 风险      |
| ----------------- | ---------- | --------- |
| iLovePDF/Smallpdf | 上传服务器 | 隐私泄露  |
| **HALO**          | 100% 本地  | ✅ 零风险 |

---

# 二、程序员工具集调研

## 1. 功能矩阵

| 工具              | 现状                   | 优先级 | 复杂度 | 依赖     |
| ----------------- | ---------------------- | ------ | ------ | -------- |
| **JSON 格式化**   | ✅ 已有                | -      | 低     | 无       |
| **正则测试器**    | 🔜 待开发              | P1     | 中     | 无       |
| **Base64 编解码** | 🔜 待开发              | P1     | 低     | 无       |
| **Hash 生成器**   | 🔜 待开发              | P1     | 低     | 无       |
| **时间戳转换**    | 🔜 待开发              | P1     | 低     | 无       |
| **URL 编解码**    | 🔜 待开发              | P1     | 低     | 无       |
| **代码片段管理**  | 🔜 待开发              | P2     | 中     | Prism.js |
| **Diff 对比**     | 🔜 待开发              | P2     | 高     | diff     |
| **UUID 生成器**   | 🔜 待开发              | P1     | 低     | 无       |
| **颜色转换**      | ✅ 已有 (color-picker) | -      | 低     | 无       |

## 2. 详细功能设计

### 2.1 正则测试器 (Regex Tester)

**功能**:

- 实时匹配高亮
- 支持 flags: g/i/m/s/u
- 匹配结果列表 (line, column, groups)
- 常用正则模板 (email, URL, IP, phone, date)
- 替换预览
- 导出匹配结果

**UI**:

```
┌─────────────────────────────────┐
│ Pattern: [_______________] [gim]│
├─────────────────────────────────┤
│ Test String:                    │
│ ┌─────────────────────────────┐ │
│ │ The quick [brown] fox...    │ │ ← 高亮匹配
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Matches: 3                      │
│ 1. "brown" (line 1, col 11)     │
│ 2. "jumps" (line 2, col 5)      │
└─────────────────────────────────┘
```

**体积**: ~8KB (无依赖)

### 2.2 Base64 编解码

**功能**:

- 文本 ↔ Base64
- URL 安全 Base64
- 文件 → Base64 DataURL
- 图片预览 (Base64 → preview)
- 批量处理

**体积**: ~3KB (无依赖)

### 2.3 Hash 生成器

**功能**:

- 算法: MD5, SHA-1, SHA-256, SHA-512, CRC32
- 输入: 文本 / 文件拖拽
- 输出: HEX / Base64
- 批量文件校验

**技术**: Web Crypto API (浏览器内置, 无依赖)

**体积**: ~5KB

### 2.4 时间戳转换

**功能**:

- Unix 秒/毫秒/微秒 ↔ 日期时间
- 多时区支持
- 自定义格式
- 当前时间戳一键复制
- 时间差计算

**体积**: ~4KB (无依赖)

### 2.5 URL 编解码

**功能**:

- encodeURIComponent / decodeURIComponent
- 完整 URL 解析 (protocol, host, path, query, hash)
- Query 参数表格编辑
- 批量处理

**体积**: ~3KB (无依赖)

### 2.6 UUID 生成器

**功能**:

- UUID v1/v4/v5/v7
- 批量生成
- ULID 支持
- 一键复制

**技术**: crypto.randomUUID() (浏览器内置)

**体积**: ~2KB

### 2.7 代码片段管理 (Snippets)

**功能**:

- 语法高亮 (100+ 语言)
- 标签分类
- 全文搜索
- 导入/导出 (JSON/Gist)
- 快速插入 (右键菜单)

**技术**: Prism.js (语法高亮)

**体积**: ~50KB (含常用语言)

### 2.8 Diff 对比

**功能**:

- 文本对比 (并排/行内)
- JSON 结构对比
- 语法高亮
- 行号显示
- 差异统计

**技术**: diff 库

**体积**: ~30KB

## 3. 架构建议

### 3.1 DevTools 聚合模块

```text
tools/devtools/
├── index.ts          # 导出入口
├── types.ts          # 共享类型
├── panel.tsx         # 聚合面板 (Tab 切换)
├── regex/            # 正则测试
│   ├── core.ts
│   └── panel.tsx
├── base64/           # Base64
│   ├── core.ts
│   └── panel.tsx
├── hash/             # Hash
│   ├── core.ts
│   └── panel.tsx
├── timestamp/        # 时间戳
│   ├── core.ts
│   └── panel.tsx
├── url/              # URL
│   ├── core.ts
│   └── panel.tsx
└── uuid/             # UUID
    ├── core.ts
    └── panel.tsx
```

### 3.2 存储键

```ts
// 开发者工具聚合存储
HALO_DEVTOOLS_REGEX_HISTORY;
HALO_DEVTOOLS_SNIPPETS;
HALO_DEVTOOLS_PREFERENCES;
```

---

# 三、综合实施建议

## Phase 3: DevTools 快速交付 (1 周)

| 天  | 任务              |
| --- | ----------------- |
| D1  | regex + base64    |
| D2  | hash + uuid       |
| D3  | timestamp + url   |
| D4  | DevTools 聚合面板 |
| D5  | 测试 + 优化       |

**预计新增体积**: ~30KB

## Phase 4: PDF 工具箱 (2 周)

| 周  | 任务                     |
| --- | ------------------------ |
| W1  | pdf-lib 集成 + 合并/拆分 |
| W2  | 预览 + 压缩 (WASM)       |

**预计新增体积**: 基础 300KB + WASM 按需 5MB

---

# 四、竞争优势

| 维度     | 竞品           | HALO          |
| -------- | -------------- | ------------- |
| **隐私** | 多数上传服务器 | ✅ 100% 本地  |
| **体积** | 单一功能插件   | ✅ 聚合工具箱 |
| **速度** | 网络延迟       | ✅ 即时处理   |
| **离线** | ❌ 需联网      | ✅ 完全离线   |
| **费用** | 部分付费       | ✅ 免费开源   |
