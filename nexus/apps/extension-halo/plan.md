# HALO 扩展规划 (Roadmap)

> **定位**: 离线优先的开发者与效率工具箱

## 📅 阶段 1: 核心基础 (P0) [✅ 已完成]

### 架构与基础设施

- [x] SidePanel 独立窗口架构
- [x] 主题系统 (CSS Variables, 跟随系统)
- [x] 国际化 (i18n, 中英)
- [x] 消息总线 (Kernel RPC)

### 基础工具集

- [x] **二维码**: 生成(SVG/PNG), 识别, 图标嵌入
- [x] **颜色拾取**: EyeDropper, 格式转换(Hex/RGB/HSL)
- [x] **屏幕尺子**: 覆盖层绘制, 辅助线
- [x] **JSON 格式化**: 树形视图, 校验, 压缩
- [x] **大纲导航**: 自动提取 H1-H6, 平滑滚动跳转
- [x] **设置**: 语言切换, 主题配置, 数据重置

---

## 📅 阶段 2: 开发者套件 (P1) [✅ 已完成]

> **Local First & Performance**

- [x] **正则 (Regex)**: 实时匹配, 替换预览, Flags, 预设
- [x] **Base64**: 编解码, URL Safe, 文件转 DataURL
- [x] **哈希 (Hash)**: SHA 系列 (Web Crypto API), 文件完整性校验
- [x] **UUID**: v4/v7/ULID 生成, 批量控制
- [x] **时间戳 (Time)**: 双向转换, 实时监控
- [x] **URL**: 编解码, 参数深度解析

---

## 📅 阶段 3: 效率体验 (P1) [✅ 已完成]

- [x] **剪贴板**: 历史记录, 搜索, 置顶
- [x] **平滑滚动**: 物理引擎 (Spring/Quartic), 防止抖动
- [x] **标签管理**: 垂直标签页, 搜索
- [x] **截图批注**: 全屏/区域截图 + 本地标注

---

## 📅 阶段 4: 蓝海护城河 (P2) [🚧 启动中]

> **Strategy**: 取代 He3 的浏览器原生终极开发者套件 (SidePanel + Local First + Hybrid Engine)

### PDF 工具箱 (High Priority)

- [ ] **Local Core**: 基于 `pdf-lib` 实现合并/拆分/转换 (验证懒加载架构)
- [ ] **UI Panel**: 拖拽交互 + 右键菜单集成
- [ ] **Lazy Load**: 路由级代码分包 + 资源动态加载

### 原子化工具矩阵 (Atomic Modules)

> **目标**: 吞噬 He3 功能，利用 Atomic 架构快速堆叠

- [ ] **Extension Manager**: 侧边栏原生管理 (分组/快捷键)
- [ ] **Crypto**: JWT / RSA / AES
- [ ] **Generator**: Lorem Ipsum / Mock Data
- [ ] **Network**: UA Parser / Curl Converter

### 网页存档 (Browser Native)

- [ ] 完整页面快照 (MHTML/HTML+Assets)
- [ ] 离线阅读器

### 脚本净化 (UserScripts)

- [ ] 动态注入框架
- [ ] 热门站点去广规则

---

## 🔗 关联文档

- [架构规范](docs/architecture.md)
- [功能调研](docs/research.md)
- [开发流程](../../docs/ai-rules.md)
