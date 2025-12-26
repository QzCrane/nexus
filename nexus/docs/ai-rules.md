# AI 规则

## 架构约束

**核心**: 单向依赖，层级清晰。

依赖链: Contracts ← Kernel ← Audio-Engine ← Spectra

导入规范:

- 允许: 包入口导出 / 上层引用下层
- 禁止: 深层路径导入 / 循环依赖 / 底层引用上层

职责:

- Contracts: 接口定义，禁止任何逻辑
- Kernel: RPC+存储中转，禁止业务实现
- Audio-Engine: WebAudio 链路，禁止 UI/Chrome API
- Spectra: UI+Chrome 调度

策略禁令:

- 禁止: 硬编码 URL/规则表
- 依据: 仅 WebAudio 行为判断

---

## 代码质量

**硬限位**: 源码 ≤200 行，index.ts 仅导出 ≤50 行。

拆分信号:

- 函数 >50 行: 即刻预警
- 文件 >150 行: 即刻预警
- 职责 >2 个: 拆分
- Import 混乱: 拆分

标准结构:

```text
module/
├── index.ts     # 唯一出口
├── types.ts     # 领域类型
├── core.ts      # 稳定算法
└── [feature].ts # 原子功能
```

红线:

- 禁止: 在 >200 行文件中新增代码
- 原则: 单文件单职责，目录深度 ≤3

---

## 文档压缩

**目标**: 最高信息熵/Token 比。

格式选择:

- 2 列映射 → `A: B` 或 `A → B`
- 流程链 → `A → B → C`
- ≥3 列对比 → 表格
- 约束列表 → `-` 列表

压缩词汇 (禁用 → 替代):

- 请注意/注意 → 直接陈述
- 我们建议/建议 → 直接陈述
- 的时候/当...时 → 删除或 `→`
- 进行/执行/实现 → 直接动词
- 相关的/相应的 → 删除
- 可以/能够/应该 → 删除

内容规则:

- 单点定义: 规则仅在最相关位置定义一次
- 引用替代: 其他位置用 `→ 见 [文档名]`
- 分隔符一致: 全局统一用 `:` 或 `→`

硬限位:

- .ai-context.md: ≤30 行
- 单行: ≤80 字符

---

## 安全红线

**核心**: 零硬编码，最小权限。

- 凭证: 禁止硬编码 Key/Token，用 import.meta.env
- 脱敏: 日志脱敏 URL 参数与用户信息
- 权限: 仅 storage / scripting / offscreen
- 禁止: history / bookmarks / eval / 内联脚本

---

## 环境与依赖

**环境**: pnpm workspace

命令:

- `pnpm install`: 安装依赖
- `pnpm build`: 全量构建
- `pnpm --filter [name] build`: 单包构建

内部包引用: `"@nexus/[name]": "workspace:*"`

依赖规则:

- 引入前必查 → [dependencies.md](dependencies.md)
- 同类库禁止重复 (如 lodash vs underscore)
- 安装后须登记清单 (库名/版本/用途/日期)
- 删除须同步更新清单
