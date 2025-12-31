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

## 📅 阶段 4: 蓝海护城河 (P2) [🚧 进行中]

> **Strategy**: 取代 He3 的浏览器原生终极开发者套件 (SidePanel + Local First + Hybrid Engine)

### PDF 工具箱 (High Priority)

- [x] **Lazy Load**: 路由级代码分包 (React.lazy + Suspense) + ResourceManager 基建
- [x] **Local Core**: 基于 `pdf-lib` 实现 Merge/Split/Extract/Rotate/Watermark/ImagesToPDF
- [x] **UI Panel**: 拖拽交互 + 操作选择 (Merge 已验证)
- [x] **Full UI**: 完整交互 (Split/Extract/Rotate/Watermark/ImagesToPDF) + 配置面板
- [x] **右键菜单**: Context Menu 集成 (Open PDF in HALO)

### UI 交互增强 (UX Polish)

- [x] **Command Palette**: Ctrl+K 快速工具搜索 (模糊匹配 + 键盘导航)
- [x] **Lazy Tool Loader**: 懒加载渲染器 + Skeleton 占位 + 悬停预加载
- [x] **New Layout Architecture**:
  - [x] **Dual Mode**: 经典模式 (Toolbar) 与 启动器模式 (Launcher) 一键切换
  - [x] **Launcher Layout**: 移动端风格首页, 分类网格, 独立搜索入口
  - [x] **Classic Layout**: 可调节高度工具栏, 优雅滚动条, 智能防误触限制
  - [x] **Adaptive UI**: 响应式标签显示 (Show/Hide Labels), 自动布局调整
- [x] **Visual Polish**: 统一滚动条样式 (.halo-scrollbar), 动效优化

### 模块商店 (Module Store)

> **核心**: 用户可选安装/卸载工具模块，类似 VSCode 扩展市场

- [x] **Module Registry**: 模块元数据定义 (核心/可选)
- [x] **Module Manager**: IndexedDB 持久化 + 安装/卸载/更新逻辑
- [x] **React Hook**: useModuleManager 响应式状态
- [x] **Store UI**: 模块浏览/安装/卸载面板
- [x] **集成到 SidePanel**: 工具栏 + 懒加载 + i18n
- [x] **动态工具栏**: 根据已安装模块渲染工具按钮
- [x] **远程 Registry**: 从服务器获取可用模块列表 (支持版本检查与更新)

### 原子化工具矩阵 (Atomic Modules)

> **目标**: 吞噬 He3 功能，利用 Atomic 架构快速堆叠

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
