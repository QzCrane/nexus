---
type: reference
status: draft
audience: developer
owner: repository-library-reuse-decisions
last_reviewed: 2026-09-07
---

# NEXUS 全仓复用审查与实施边界

选型证据截至 2026-09-07；被审查的实施基准是 `93edb5dccdd47f16f0a93899054a4aeb8569068f`，不是永远不变的分支 head。

## 范围与证据

完整本地7230源码树；其与integration49df树相同；另用GitHub比较49df→93ed的46个变更路径及最新关键文件复核。未变化文件可沿用源码证据；已修复的identity/storage项目不重复报旧缺陷。
目录/依赖声明/关键实现与上游官方文档、部分源代码、安全公告和许可证的选型审查；不是逐函数形式验证或所有上游发布包准入

扫描 8 份 package.json、82 个 HALO 工具目录，以及系统/共享内核/音频/远控/构建/治理/测试边界。下列 56 个决策单元不是新增包数量，同一库可服务多个工具；备选库不是同时安装名单。
原选型审查未安装候选包、未改生产源码或锁文件。本次将全部选型决策提交仓库，但提交设计不等于包已安装、准入或任务已实现。接入前必须核实具体版本、发布包许可证、依赖公告以及 Nexus 的真实运行条件。

## 与已有决策和实施状态的关系

[仓库规则](../../../rules.md)规定复用评估必须先于手写通用实现；本文件是56个选型方向、取舍、适配边界和验收向量的唯一说明，不是新增56个依赖的安装授权清单。

[原86项完整审计](../_archive/audits/2026-09-06-7230b68.json)已保留全部事实、机制、设计与验收；其 Git blob 为 `63006861c8984860767369af2e745ca7b19b9373`，不重复复制或覆盖。[实施状态](../../remediation-status.json)仍是缺陷实施状态的唯一来源。[复用实施映射](../../reuse-remediation-map.json)只关联任务和选型，不拥有第二份完成状态。[取舍复盘与执行顺序](reuse-first-execution.md)记录保留成果、可避免返工、异常批准和分支处理。

所有现有正确的业务行为、测试向量、数据和安全边界必须保留；旧算法在替代引擎通过相同语义与运行验收后删除，不因已经投入成本而永久并行。已实现缺陷不因可能换库而重新标成未实现，也不因登记库名而自动关闭。

## 核心裁决

标准语法、通用算法、HTML清洗、存储事务封装和通用工程分析应优先成熟库；Nexus独有的文档身份、权限、资源单一所有权、操作确认、任务退出、数据迁移和发布政策由原有领域owner保留。已有正确回归不删除，改为新适配器的入场向量。
每个候选引入后要删除被它接管的旧实现；不允许旧parser、新parser和同义规则长期形成两套权威。短期应急修复不是必须永久自维护标准算法的理由。

## 五个接入陷阱

1. Papa Parse 内置 worker 使用 Blob URL；推荐本地静态worker入口内调用其解析API，不为库放宽CSP。
2. Ajv运行时编译和Zod显式compile可生成代码；MV3优先构建期standalone或非JIT路径。
3. DOMPurify/Readability需要DOM；纯计算worker不能直接代替DOM环境。
4. p-limit/p-queue提供排队，并不自动终止Chrome物理操作；不能破坏已修的实际完成许可。
5. HALO生产通过Preact compat单渲染器；新增React生态组件不能未经验证带入第二renderer。

## 当前直接反例

见[原实现反例](../_archive/audits/2026-09-07-reuse-probes.json)：围栏代码中的 `**literal**` 被二次处理为 strong；blockquote转义后未识别；HTML非BMP实体编码为UTF-16高代理值，十六进制解码也发生截断。这些是原实现反例，不是候选库已经通过测试。

## 决策明细

### R01 · CSV — Papa Parse

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/csv-viewer/core.ts`；`nexus/apps/extension-halo/src/tools/csv-to-json/core.ts`；`nexus/apps/extension-halo/src/tools/json-to-csv/core.ts`。
**由轮子接管：**合并三处手工 CSV 解析/输出算法。
**保留自有职责：**编码、重复表头、数据类型、公式导出策略和任务预算。
**边界与反转条件：**默认保留字符串；有解析 errors 不得当完整成功；内置 worker 为 Blob 实现，应封装静态扩展 worker。
**验收：**多行引号、转义引号、重复列、001、大整数、BOM、空记录、公式模式、取消。
**原始来源：**[www.papaparse.com/docs](https://www.papaparse.com/docs)；[raw.githubusercontent.com/mholt/PapaParse/master/papaparse.js](https://raw.githubusercontent.com/mholt/PapaParse/master/papaparse.js)。

### R02 · YAML — yaml (eemeli)

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/yaml/core.ts`。
**由轮子接管：**手工缩进/标量/集合解析与输出。
**保留自有职责：**用户选择的 YAML 版本、标签和 JSON 转换边界。
**边界与反转条件：**parseDocument 错误检查；限制别名展开；JSON 无法表示的值不能默默改变；不再并行新增 js-yaml 做同一功能。
**验收：**true/001 字符串、复杂集合、重复键、别名、深层嵌套、大整数、非法结构。
**原始来源：**[eemeli.org/yaml/](https://eemeli.org/yaml/)。

### R03 · JSON 格式编辑 — jsonc-parser

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/json-formatter/core.ts`；`nexus/apps/extension-halo/src/tools/code-formatter/core.ts`。
**由轮子接管：**以 parse/stringify 代替格式化的路径。
**保留自有职责：**严格 JSON 与 JSONC 模式、原始文本和诊断。
**边界与反转条件：**使用词法/语法树及 format 文本编辑；普通 parse 返回 Number 不能保证精度。
**验收：**超精度数字原文、重复键、注释模式、换行、__proto__ 自有键。
**原始来源：**[github.com/microsoft/node-jsonc-parser](https://github.com/microsoft/node-jsonc-parser)。

### R04 · JSON 语义转换 — lossless-json

**裁决：按操作引入**。
对应位置：`nexus/apps/extension-halo/src/tools/json-formatter/core.ts`；`nexus/apps/extension-halo/src/tools/csv-to-json/core.ts`；`nexus/apps/extension-halo/src/tools/yaml/core.ts`。
**由轮子接管：**会舍入用户数字的通用 JSON 解析。
**保留自有职责：**跨格式转换时明确数值类型、排序和重复键政策。
**边界与反转条件：**不是全仓 JSON.parse 替代；LosslessNumber/BigInt 不可直接进入普通 Chrome JSON 状态；查询引擎精确比较需单独适配。
**验收：**巨大整数、十进制、指数、-0、重复键与跨 worker 编码。
**原始来源：**[github.com/josdejong/lossless-json](https://github.com/josdejong/lossless-json)。

### R05 · JSONPath — @swaggerexpert/jsonpath；jsonpathly 作为比较候选

**裁决：标准候选试点**。
对应位置：`nexus/apps/extension-halo/src/tools/json-path/core.ts`。
**由轮子接管：**手工路径 tokenizer 和不完整遍历。
**保留自有职责：**明确支持 RFC 9535 或命名的旧方言；用户查询不可执行 JS。
**边界与反转条件：**上游合规声明需本地合规集复验；JSONPath-Plus 的 eval:false 可用于明确子集，不冒充完整兼容；不把自定义函数作为字符串执行。
**验收：**RFC 合规集、递归查询、继承属性、过滤函数、资源上限、无损数字桥接。
**原始来源：**[github.com/swaggerexpert/jsonpath](https://github.com/swaggerexpert/jsonpath)；[github.com/atamano/jsonpathly](https://github.com/atamano/jsonpathly)；[www.rfc-editor.org/rfc/rfc9535.html](https://www.rfc-editor.org/rfc/rfc9535.html)；[github.com/JSONPath-Plus/JSONPath](https://github.com/JSONPath-Plus/JSONPath)。

### R06 · SQL — sql-formatter

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/sql-formatter/core.ts`；`nexus/apps/extension-halo/src/tools/code-formatter/core.ts`。
**由轮子接管：**按正则大小写/空格修改 SQL。
**保留自有职责：**方言选择、错误报告和输入原文。
**边界与反转条件：**格式化器不验证表是否存在、权限或查询是否可执行；不支持方言明确拒绝。
**验收：**字符串 FROM、转义引号、注释、引用标识符、方言专项。
**原始来源：**[github.com/sql-formatter-org/sql-formatter](https://github.com/sql-formatter-org/sql-formatter)。

### R07 · 代码格式化 — Prettier standalone + 明确 parser plugins

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/code-formatter/core.ts`。
**由轮子接管：**JS/TS/HTML/CSS 手工重排。
**保留自有职责：**产品格式化选项与任务生命周期。
**边界与反转条件：**这是用户工具运行时，不是替换仓库 Biome；插件按实际语言打包，浏览器不会自动发现配置和插件。
**验收：**嵌套语法、字符串/模板、注释、HTML 空白、插件缺失、任务退休。
**原始来源：**[prettier.io/docs/browser](https://prettier.io/docs/browser)。

### R08 · JavaScript 压缩 — Terser 浏览器入口

**裁决：扩展现有技术复用**。
对应位置：`nexus/apps/extension-halo/src/tools/code-formatter/core.ts`；`nexus/apps/extension-spectra/package.json`。
**由轮子接管：**手工删除 JS 空白/注释的压缩。
**保留自有职责：**压缩选项、支持语法、取消和输出大小。
**边界与反转条件：**SPECTRA 构建 devDependency 不等于 HALO 可隐式运行时导入；新增真实消费者需显式声明；不执行用户代码。
**验收：**行注释换行、ASI、模板字面量、正则字面量、异常、预算。
**原始来源：**[terser.org/docs/api-reference/](https://terser.org/docs/api-reference/)。

### R09 · CSS 压缩 — CSSO / css-tree

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/code-formatter/core.ts`。
**由轮子接管：**CSS 字符串级压缩。
**保留自有职责：**不支持语法和资源预算。
**边界与反转条件：**CSSO 与 css-tree 按一个算法链选用，不是加两份平行压缩器；Raw 节点与未知语法不得擅改。
**验收：**字符串空格、转义、calc、自定义属性、未知 at-rule。
**原始来源：**[github.com/css/csso](https://github.com/css/csso)；[github.com/csstree/csstree](https://github.com/csstree/csstree)。

### R10 · XML — DOMParser/XMLSerializer；复杂格式化评估 @prettier/plugin-xml

**裁决：平台优先/条件扩展**。
对应位置：`nexus/apps/extension-halo/src/tools/xml-formatter/core.ts`。
**由轮子接管：**手工节点串接和无条件删空白。
**保留自有职责：**混合内容、CDATA、命名空间、外部实体策略。
**边界与反转条件：**DOM 往返不保证文本字节原样；XML 插件需 browser 构建试验；不要默认 ignore whitespace；XML→对象库不等于无损 formatter。
**验收：**混合内容、xml:space、属性实体、CDATA、DOCTYPE、处理指令。
**原始来源：**[github.com/prettier/plugin-xml](https://github.com/prettier/plugin-xml)。

### R11 · Markdown — marked + 独立 DOMPurify 消毒

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/markdown/core.ts`。
**由轮子接管：**顺序正则 Markdown 解析。
**保留自有职责：**已支持语法、链接政策、预览任务和原文。
**边界与反转条件：**marked 不是 sanitizer；代码块不能再被加粗/标题规则加工；不要用 raw HTML 截断代替 DOM 裁剪。
**验收：**围栏代码内 **、引用、表格、嵌套列表、恶意链接、HTML 处理。
**原始来源：**[github.com/markedjs/marked](https://github.com/markedjs/marked)；[github.com/cure53/DOMPurify](https://github.com/cure53/DOMPurify)。

### R12 · HTML 清洗 — DOMPurify

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/markdown/core.ts`；`nexus/apps/extension-halo/src/tools/reader-mode/panel.tsx`。
**由轮子接管：**正则 HTML sanitizer。
**保留自有职责：**最终 URL/外部资源政策和最小允许列表。
**边界与反转条件：**需要 DOM，不是直接放进 DOMless worker；对最终 HTML 清洗，随后不拼接未清洗 HTML；CSP 不是其替代。
**验收：**畸形 HTML、事件属性、SVG/MathML、URL scheme、后处理重污染。
**原始来源：**[github.com/cure53/DOMPurify](https://github.com/cure53/DOMPurify)。

### R13 · 正文提取 — @mozilla/readability

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/reader-mode/core.ts`。
**由轮子接管：**article/main/最大文本容器启发式。
**保留自有职责：**准确页面身份、用户触发、外链和图片隐私。
**边界与反转条件：**在克隆 DOM 上解析；Readability 不清洗 HTML；明确元素预算和未能提取的结果。
**验收：**新闻/论坛/动态页、无正文、脏 DOM、相对 URL、资源隐私。
**原始来源：**[github.com/mozilla/readability](https://github.com/mozilla/readability)。

### R14 · HTML 实体 — entities

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/html-entity/core.ts`。
**由轮子接管：**不完整命名表和 UTF-16 单码元转换。
**保留自有职责：**HTML/XML 两种解析模式与安全输出上下文。
**边界与反转条件：**实体编解码不是 HTML 消毒；属性文本与普通文本规则不能混用。
**验收：**非 BMP、无分号/非法数字、named entities、双重编码。
**原始来源：**[github.com/fb55/entities](https://github.com/fb55/entities)。

### R15 · X.509 — @peculiar/x509

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/ssl-cert/core.ts`。
**由轮子接管：**启发式日期扫描和占位证书字段。
**保留自有职责：**证书显示、失败语义和本地处理。
**边界与反转条件：**解析、验签、链信任、主机名和撤销检查分开；不将解析成功标成可信；jsrsasign 已停止支持不作新首选。
**验收：**有效/畸形 DER/PEM、多证书、日期、OID、摘要和字段向量。
**原始来源：**[github.com/PeculiarVentures/x509](https://github.com/PeculiarVentures/x509)；[github.com/kjur/jsrsasign](https://github.com/kjur/jsrsasign)。

### R16 · JWT/JWE/JWK — 现有 jose

**裁决：复用已安装库**。
对应位置：`nexus/apps/extension-halo/src/tools/crypto/core.ts`；`nexus/apps/extension-halo/src/tools/jwt-decoder/core.ts`。
**由轮子接管：**重复 JWT/JWK 解析和签名包装。
**保留自有职责：**解码≠验签、algorithm/issuer/audience/时间政策。
**边界与反转条件：**保持已有 UTF-8 修复；不把大范围算法隐式开启；Secret 默认持久化由产品另行修复。
**验收：**Unicode、畸形输入、算法限制、签名和 claims 区别。
**原始来源：**[github.com/panva/jose](https://github.com/panva/jose)。

### R17 · TOTP/HOTP — otpauth

**裁决：合并已修复行为后的替换候选**。
对应位置：`nexus/apps/extension-halo/src/tools/totp/core.ts`；`nexus/apps/extension-halo/src/tools/totp/types.ts`。
**由轮子接管：**长期自维护 HMAC/URI 参数与向量。
**保留自有职责：**账户资料、Secret 保留/迁移、UI 时间刷新。
**边界与反转条件：**保留已修的 SHA-1/256/512 与 issuer 边界；库不提供私钥保险库或背景计时权威。
**验收：**RFC 向量、错误类型、period、digits、URI 编解码和时钟边界。
**原始来源：**[github.com/hectorm/otpauth](https://github.com/hectorm/otpauth)。

### R18 · UUID — uuid；仅 v4 用 crypto.randomUUID

**裁决：条件整合**。
对应位置：`nexus/apps/extension-halo/src/tools/uuid/core.ts`；`nexus/apps/extension-halo/src/tools/random-gen/core.ts`。
**由轮子接管：**重复标准位布局和编码。
**保留自有职责：**旧 ID 不改写、v7 时间/单实例顺序需求。
**边界与反转条件：**当前截断已修不应抹掉；第三方不证明跨上下文全局单调；同时有多版本需求才引入。
**验收：**固定毫秒向量、variant/version、溢出、随机源、历史兼容。
**原始来源：**[github.com/uuidjs/uuid](https://github.com/uuidjs/uuid)。

### R19 · 哈希 — Web Crypto；增量算法评估 @noble/hashes

**裁决：平台优先/条件扩展**。
对应位置：`nexus/apps/extension-halo/src/tools/hash/core.ts`；`nexus/apps/extension-halo/src/tools/checksum/core.ts`；`nexus/apps/extension-halo/src/tools/crypto/core.ts`。
**由轮子接管：**重复算法与重复全文件读取。
**保留自有职责：**算法安全等级、取消、字节统计。
**边界与反转条件：**WebCrypto 没有通用增量 digest；兼容 MD5 不作为安全密码方案；库算法不自动解决文件读取次数。
**验收：**公共摘要向量、分块等价、空文件、大文件预算和取消。
**原始来源：**[github.com/paulmillr/noble-hashes](https://github.com/paulmillr/noble-hashes)。

### R20 · Protobuf — protobufjs 的 minimal/light/static 模式

**裁决：条件替换**。
对应位置：`nexus/apps/extension-halo/src/tools/protobuf/core.ts`。
**由轮子接管：**wire 解码/已知 schema 编解码。
**保留自有职责：**无 schema 只报告 wire 事实、不猜字段意义。
**边界与反转条件：**已修 BigInt 行为需保持；Long/BigInt 边界显式转换，不能退成 Number；整套反射仅需要时带入。
**验收：**64 位/负数/截断 varint、length bounds、unknown fields、schema匹配。
**原始来源：**[github.com/protobufjs/protobuf.js](https://github.com/protobufjs/protobuf.js)。

### R21 · IP/CIDR — ipaddr.js

**裁决：优先标准化**。
对应位置：`nexus/apps/extension-halo/src/tools/network/core.ts`；`nexus/apps/extension-halo/src/tools/ip-lookup/core.ts`。
**由轮子接管：**手写私网地址字面量分类。
**保留自有职责：**URL canonicalization、允许目标与 DNS/重定向边界。
**边界与反转条件：**严格文本和旧式地址语法需明确；解析地址不防 DNS rebinding；检查所有可观察目标但不虚假声称全链保证。
**验收：**IPv4-mapped IPv6、链路本地、回环、CIDR、十六/八进制拒绝策略。
**原始来源：**[github.com/whitequark/ipaddr.js](https://github.com/whitequark/ipaddr.js)。

### R22 · 域名分组 — tldts

**裁决：只在需要公共后缀域名语义时**。
对应位置：`nexus/apps/extension-halo/src/tools/url/core.ts`；`nexus/apps/extension-spectra/src/background`。
**由轮子接管：**手工 split 点号取主域。
**保留自有职责：**精确 origin/hostname 授权键。
**边界与反转条件：**eTLD+1 是分组，不是同权限身份；不得默默改变现有站点配置键。
**验收：**co.uk、私有后缀、localhost、IP、IDN和历史键兼容。
**原始来源：**[github.com/remusao/tldts](https://github.com/remusao/tldts)。

### R23 · EXIF — exifr

**裁决：优先候选**。
对应位置：`nexus/apps/extension-halo/src/tools/exif-reader/core.ts`。
**由轮子接管：**手写 TIFF/IFD 偏移与 EXIF 标签解析。
**保留自有职责：**本地处理、GPS 隐私和文件预算。
**边界与反转条件：**元数据读取不等于写回或无损删除；按格式选择 bundle。
**验收：**畸形 offset、大小端、orientation、GPS、截断文件和不支持格式。
**原始来源：**[github.com/MikeKovarik/exifr](https://github.com/MikeKovarik/exifr)。

### R24 · 图像处理 — Canvas/createImageBitmap；高质量缩放用 pica

**裁决：条件引入**。
对应位置：`nexus/apps/extension-halo/src/tools/image-tools/core.ts`。
**由轮子接管：**自制重采样算法或低质量缩放。
**保留自有职责：**解码像素预算、方向、颜色与任务取消。
**边界与反转条件：**不要把 Node sharp 塞进扩展；仅基本裁剪无需新增重库。
**验收：**大尺寸压缩图片、方向、Alpha、取消、内存和像素质量。
**原始来源：**[github.com/nodeca/pica](https://github.com/nodeca/pica)。

### R25 · Gzip/Zip — CompressionStream/DecompressionStream；Zip/后备用 fflate

**裁决：平台优先/条件扩展**。
对应位置：`nexus/apps/extension-halo/src/tools/gzip/core.ts`。
**由轮子接管：**重复压缩格式实现。
**保留自有职责：**输入输出预算、流背压、取消、字节所有权。
**边界与反转条件：**fflate自动worker必须检查CSP；放入静态worker可不用其Blob worker；压缩库不自动防解压炸弹。
**验收：**输出膨胀、截断流、writer 错误、取消、慢消费者。
**原始来源：**[github.com/101arrowz/fflate](https://github.com/101arrowz/fflate)。

### R26 · 大 Zip — zip.js

**裁决：仅 Zip64/流式容器能力明确需要时**。
对应位置：`nexus/apps/extension-halo/src/tools/archive/core.ts`；`nexus/scripts`。
**由轮子接管：**大容器读写。
**保留自有职责：**路径、元数据、资源限额和确定性。
**边界与反转条件：**不要与 fflate 维护两套同用途 owner；Node 发布产物 ZIP 和浏览器用户 ZIP 可以是不同运行域。
**验收：**Zip64、路径穿越、重复名、符号链接、字节预算、可重现归档。
**原始来源：**[github.com/gildas-lormeau/zip.js](https://github.com/gildas-lormeau/zip.js)。

### R27 · PDF — 现有 pdf-lib

**裁决：保留库，修适配层**。
对应位置：`nexus/apps/extension-halo/src/tools/pdf/core.ts`；`nexus/apps/extension-halo/src/tools/pdf/panel.tsx`。
**由轮子接管：**无需重新造 PDF 文档引擎。
**保留自有职责：**全部 outputs、页范围、worker、取消、预算。
**边界与反转条件：**仅为了修拆分丢结果不引入 PDF.js；PDF.js 对应渲染/提取业务而非当前拼接编辑缺陷。
**验收：**多范围全部输出、越界拒绝、损坏文件、卸载和取消。
**原始来源：**[github.com/Hopding/pdf-lib](https://github.com/Hopding/pdf-lib)。

### R28 · Diff — diff (jsdiff)

**裁决：优先替换**。
对应位置：`nexus/apps/extension-halo/src/tools/diff/core.ts`。
**由轮子接管：**完整二维 LCS 矩阵。
**保留自有职责：**比较模式、换行/Unicode语义、工作量限额。
**边界与反转条件：**使用 maxEditLength/timeout 的可中止 API；undefined 是预算退出，不是空差异。
**验收：**极不相似大文本、重复行、Unicode、预算、结果重放。
**原始来源：**[github.com/kpdecker/jsdiff](https://github.com/kpdecker/jsdiff)。

### R29 · Cron — cron-parser

**裁决：优先候选**。
对应位置：`nexus/apps/extension-halo/src/tools/cron/core.ts`。
**由轮子接管：**手工字段与七天暴力搜索。
**保留自有职责：**5/6字段方言、时区、DST、最多结果和取消。
**边界与反转条件：**依赖和浏览器构建需验证；它不替代 chrome.alarms；reset时区历史回归加入向量。
**验收：**月度年周期、非法字段、跳过/重复本地时间、日期边界。
**原始来源：**[github.com/harrisiirak/cron-parser](https://github.com/harrisiirak/cron-parser)。

### R30 · IndexedDB — idb；复杂持久模型才选择 Dexie

**裁决：优先引入单一封装**。
对应位置：`nexus/apps/extension-halo/src/tools/archive/core.ts`；`nexus/packages/nexus-kernel/src/storage`。
**由轮子接管：**事件回调式 IDB 和请求/事务确认混淆。
**保留自有职责：**元数据/Blob 同事务、升级迁移、删除保留策略。
**边界与反转条件：**idb 与 Dexie 同一数据域二选一；tx.done 才是完成；不能跨事务等待网络；不会让 chrome.storage 获得 CAS。
**验收：**request成功后abort、多页并发、upgrade blocked、迁移回滚、孤儿回收。
**原始来源：**[github.com/jakearchibald/idb](https://github.com/jakearchibald/idb)；[dexie.org/docs/Tutorial/Best-Practices](https://dexie.org/docs/Tutorial/Best-Practices)。

### R31 · 运行时 schema — Valibot；既有 JSON Schema 域用 Ajv standalone

**裁决：优先试点**。
对应位置：`nexus/packages/contracts/src`；`nexus/packages/nexus-kernel/src/diagnostics.ts`；`nexus/apps/extension-halo/src/kernel/hooks/use-tool-state.ts`。
**由轮子接管：**重复结构 guard、容器种类冒充完整 schema。
**保留自有职责：**sender/doc/generation/revision、迁移和副作用许可。
**边界与反转条件：**同一合同唯一 schema权威；Ajv运行时代码生成不进入MV3；Zod可比较但不并行多权威。
**验收：**未知字段、版本迁移、损坏状态、类型推导、CSP、热路径clone成本。
**原始来源：**[valibot.dev/guides/introduction/](https://valibot.dev/guides/introduction/)；[ajv.js.org/standalone.html](https://ajv.js.org/standalone.html)；[github.com/colinhacks/zod](https://github.com/colinhacks/zod)。

### R32 · Worker 调用 — Comlink

**裁决：仅重复RPC胶水有实际规模时**。
对应位置：`nexus/apps/extension-halo/src/kernel`；`nexus/apps/extension-halo/src/tools/pdf`；`nexus/apps/extension-halo/src/tools/regex`；`nexus/apps/extension-halo/src/tools/image-tools`。
**由轮子接管：**纯计算 worker 的参数/结果传递。
**保留自有职责：**task ID、取消、预算、销毁、异常和转移所有权。
**边界与反转条件：**Comlink proxy释放不等于任务终止；不替代跨扩展上下文的发送者权限。
**验收：**terminate、迟到输出、Transferable 分离、销毁重建和背压。
**原始来源：**[github.com/GoogleChromeLabs/comlink](https://github.com/GoogleChromeLabs/comlink)。

### R33 · 队列与超时 — p-limit/p-queue 只用于匹配的任务；保留物理完成owner

**裁决：不整体替换**。
对应位置：`nexus/packages/nexus-kernel/src/settlement-pool.ts`；`nexus/packages/nexus-kernel/src/storage/safe-storage.ts`。
**由轮子接管：**普通可取消任务排队可减少胶水。
**保留自有职责：**观察超时与物理完成区别、跨上下文写入协议。
**边界与反转条件：**p-queue abort/timeout 不会自动停止已执行操作；拿race返回当实际完成会重新引入缺陷。
**验收：**永久在途、并发、观察者注销、实际完成后释放、预取消信号。
**原始来源：**[github.com/sindresorhus/p-queue](https://github.com/sindresorhus/p-queue)；[github.com/sindresorhus/p-limit](https://github.com/sindresorhus/p-limit)。

### R34 · 后台任务 — chrome.alarms + 持久领域状态；保留协调器

**裁决：平台与自有领域协议**。
对应位置：`nexus/apps/extension-halo/src/tools/timer`；`nexus/apps/extension-halo/src/tools/pomodoro`；`nexus/apps/extension-spectra/src/background/control-coordinator.ts`。
**由轮子接管：**提取纯状态转换可复用结构校验。
**保留自有职责：**任务deadline、完成副作用去重和恢复、资源唯一写入者。
**边界与反转条件：**不以UI状态库或通用定时器宣称跨service-worker持久完成；不为使用框架重新造第二owner。
**验收：**休眠、worker重启、重复alarm、旧操作、恢复与用户取消。
**原始来源：**[developer.chrome.com/docs/extensions/reference/api/alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)；[developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

### R35 · 浮层定位 — @floating-ui/dom

**裁决：按真实定位复杂度引入**。
对应位置：`nexus/apps/extension-halo/src/components`；`nexus/packages/ui-kit/src`。
**由轮子接管：**手工碰撞、定位、滚动/尺寸观察。
**保留自有职责：**显隐意图、键盘语义与生命周期。
**边界与反转条件：**用DOM入口避免无意引入第二React运行时；autoUpdate清理必须闭环。
**验收：**缩放、小窗、滚动容器、RTL、卸载和重复打开。
**原始来源：**[github.com/floating-ui/floating-ui](https://github.com/floating-ui/floating-ui)。

### R36 · 焦点与对话框 — 原生dialog/inert；嵌套复杂交互用 focus-trap

**裁决：平台优先/条件引入**。
对应位置：`nexus/apps/extension-halo/src/components/ui`；`nexus/apps/extension-spectra/src/shared/accessibility.ts`。
**由轮子接管：**手工焦点循环和恢复。
**保留自有职责：**用户键盘语义、退出意图和准确目标。
**边界与反转条件：**库不负责业务取消；动态DOM和异步可见性需测试；不取消现有可访问性证据。
**验收：**Tab/ShiftTab/Escape、焦点恢复、嵌套、目标删除、动态变化。
**原始来源：**[github.com/focus-trap/focus-trap](https://github.com/focus-trap/focus-trap)。

### R37 · 代码编辑器 — CodeMirror 6

**裁决：条件UI提升**。
对应位置：`nexus/apps/extension-halo/src/tools/code-formatter`；`nexus/apps/extension-halo/src/tools/json-formatter`；`nexus/apps/extension-halo/src/tools/regex`；`nexus/apps/extension-halo/src/tools/api-tester`。
**由轮子接管：**重复语法着色、编辑历史、文本选择胶水。
**保留自有职责：**输入原文、格式化请求版本和任务预算。
**边界与反转条件：**按语言分包，EditorView销毁；不将整套Monaco装入每个短文本工具。
**验收：**中文IME、大输入、键盘、撤销、选择、卸载和编辑任务竞态。
**原始来源：**[github.com/codemirror/dev](https://github.com/codemirror/dev)。

### R38 · 大列表 — TanStack Virtual 的 virtual-core

**裁决：只有真实大列表瓶颈时**。
对应位置：`nexus/apps/extension-halo/src/components`；`nexus/apps/extension-halo/src/tools/csv-viewer`；`nexus/apps/extension-halo/src/tools/clipboard`；`nexus/apps/extension-halo/src/tools/history-search`。
**由轮子接管：**长列表窗口化。
**保留自有职责：**选中状态、键盘导航、无障碍和行身份。
**边界与反转条件：**88个菜单项不必先虚拟化；Preact需正确adapter，不能推断所有React库兼容。
**验收：**变高行、查询变化、滚动定位、键盘朗读、卸载。
**原始来源：**[tanstack.com/virtual/latest/docs/introduction](https://tanstack.com/virtual/latest/docs/introduction)。

### R39 · 搜索 — MiniSearch；小工具目录保留现有过滤+pinyin-pro

**裁决：条件扩展**。
对应位置：`nexus/apps/extension-halo/src/tools/history-search`；`nexus/apps/extension-halo/src/tools/bookmark-manager`；`nexus/apps/extension-halo/src/tools/archive`；`nexus/apps/extension-halo/src/tools/code-snippets`。
**由轮子接管：**大量本地全文搜索的线性遍历。
**保留自有职责：**索引版本、增删同步、CJK分词与不泄漏资料。
**边界与反转条件：**库不是数据来源；小集合不为用库而加索引；不默认将浏览记录上传服务。
**验收：**中文、拼音、旧索引、删除、增量、内存预算。
**原始来源：**[github.com/lucaong/minisearch](https://github.com/lucaong/minisearch)。

### R40 · 假数据 — @faker-js/faker 的所需模块/locale

**裁决：条件替换**。
对应位置：`nexus/apps/extension-halo/src/tools/mock-data/core.ts`；`nexus/apps/extension-halo/src/tools/lorem-ipsum/core.ts`。
**由轮子接管：**重复假姓名地址等生成器。
**保留自有职责：**固定seed与合成资料标识。
**边界与反转条件：**不全量导入所有locale；不用于口令、安全令牌或声称真实身份数据。
**验收：**seed重放、locale、日期范围、批量上限和包体。
**原始来源：**[fakerjs.dev/guide/usage.html](https://fakerjs.dev/guide/usage.html)。

### R41 · User-Agent — Bowser；UAParser.js v2须单独许可证裁决

**裁决：条件替换**。
对应位置：`nexus/apps/extension-halo/src/tools/user-agent/core.ts`。
**由轮子接管：**有限手写UA正则。
**保留自有职责：**UA文本分析与真实浏览器能力检测分开。
**边界与反转条件：**UA可以伪造和缩减；v2的AGPL/商业选项不是旧MIT，不做静默升级。
**验收：**UA-CH、异常UA、精确浏览器身份取自动化实际进程。
**原始来源：**[github.com/bowser-js/bowser](https://github.com/bowser-js/bowser)；[github.com/faisalman/ua-parser-js](https://github.com/faisalman/ua-parser-js)。

### R42 · 简单平台能力 — URL/URLSearchParams、BigInt、Intl、原生数值与明确常量

**裁决：保留原生优先**。
对应位置：`nexus/apps/extension-halo/src/tools/url/core.ts`；`nexus/apps/extension-halo/src/tools/number-base/core.ts`；`nexus/apps/extension-halo/src/tools/text-tools/core.ts`；`nexus/apps/extension-halo/src/tools/timestamp/core.ts`；`nexus/apps/extension-halo/src/tools/unit-converter/core.ts`。
**由轮子接管：**不完整平台功能重复实现。
**保留自有职责：**编码模式、字符/字素定义、单位与舍入规则。
**边界与反转条件：**基础功能不引入大一统utility/math/日期框架；跨时区调度等真实复杂需求再选专用库。
**验收：**重复query、超精度整数、emoji字素、时区、KB/KiB、温标。
**原始来源：**[developer.mozilla.org/en-US/docs/Web/API/URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)；[developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)。

### R43 · Web Audio — 原生Web Audio节点 + 现有图owner

**裁决：保留**。
对应位置：`nexus/packages/features/audio-engine/src/AudioGraphRouter.ts`；`nexus/packages/features/audio-engine/src/WebAudioController.ts`。
**由轮子接管：**已复用BiquadFilter/Gain/Panner，不再加通用音乐引擎。
**保留自有职责：**捕获授权、节点唯一持有、参数斜坡、读回和销毁。
**边界与反转条件：**Tone.js类框架不解决此处Chrome捕获与恢复权威；未来有新DSP需求另评算法。
**验收：**图拓扑变化、参数变化不重建、跨淡入淡出、断连回收。
**原始来源：**[developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)。

### R44 · 远控与浏览器操作 — 保留owned PeerJS与浏览器领域适配

**裁决：不盲目整包回退**。
对应位置：`remote-site`；`nexus/apps/extension-spectra/src/remote`；`nexus/apps/extension-spectra/src/background`；`nexus/apps/extension-halo/src/kernel`。
**由轮子接管：**可复用第三方协议基础，不恢复旧控制通道。
**保留自有职责：**Remote v3、会话认证、document/capture代际、真实ACK。
**边界与反转条件：**普通SDK不识别当前业务权限；更换PeerJS必须重放已有恢复/处理器身份回归。
**验收：**重复命令、重连、旧会话、导航、撤权、资源身份不变。
**原始来源：**[developer.chrome.com/docs/extensions/develop/concepts/messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)。

### R45 · 现有专业库 — darkreader、qrcode、jsqr、pinyin-pro、preact

**裁决：保留已有正确复用**。
对应位置：`nexus/apps/extension-halo/package.json`。
**由轮子接管：**不把专业算法再改成自研。
**保留自有职责：**生命周期、资源准入、用户隐私和升级证据。
**边界与反转条件：**安装存在不意味着全部能力测试；不因依赖数量指标删除真实消费者。
**验收：**darkmode退出恢复、QR识别/编码、中文检索、单renderer和最小Chrome。
**原始来源：**[github.com/darkreader/darkreader](https://github.com/darkreader/darkreader)；[github.com/cozmo/jsQR](https://github.com/cozmo/jsQR)；[github.com/soldair/node-qrcode](https://github.com/soldair/node-qrcode)；[github.com/zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)；[preactjs.com/](https://preactjs.com/)。

### R46 · 依赖/死代码检查 — Knip

**裁决：治理优先试点**。
对应位置：`nexus/scripts/check-direct-dependencies.ts`；`nexus/scripts`。
**由轮子接管：**通用unused依赖/导出/入口扫描。
**保留自有职责：**生成入口、扩展manifest入口和可选模块真实用途。
**边界与反转条件：**先完整配置entry/plugin/workspace；误报不直接删代码；TS7工具API域需验证。
**验收：**注入未用依赖应失败；真实动态入口不可被误删。
**原始来源：**[knip.dev/overview/getting-started](https://knip.dev/overview/getting-started)。

### R47 · 依赖图架构 — dependency-cruiser + 现有TypeScript API

**裁决：治理优先试点**。
对应位置：`nexus/scripts/verify-architecture.ts`；`nexus/scripts/verify`。
**由轮子接管：**通用解析依赖图/循环/层级检查。
**保留自有职责：**Nexus独有owner、权限、运行世界和治理规则。
**边界与反转条件：**只替换图提取/通用规则，不能让2套图引擎和相同规则永久并行；TS版本兼容试点。
**验收：**别名、导出、动态路径、循环和跨层注入负例。
**原始来源：**[github.com/sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser)。

### R48 · 属性/竞态测试 — fast-check

**裁决：优先引入测试域**。
对应位置：`nexus/apps/extension-halo/test`；`nexus/apps/extension-spectra/test`；`nexus/scripts`。
**由轮子接管：**大量仅含单个手写样例的测试。
**保留自有职责：**业务不变量与判定oracle。
**边界与反转条件：**随机通过不证明完备；保存seed并最小化反例；异步scheduler只控制被接入边界。
**验收：**编解码往返、恶意嵌套、操作顺序、并发旧结果与清理。
**原始来源：**[fast-check.dev/](https://fast-check.dev/)。

### R49 · 真实面板组合测试 — @testing-library/preact

**裁决：优先引入测试域**。
对应位置：`nexus/apps/extension-halo/test`。
**由轮子接管：**只查源码字符串而不挂载的UI合同测试。
**保留自有职责：**生产renderer与真实浏览器验证。
**边界与反转条件：**DOM替身不模拟Chrome权限/布局/worker；需要平台适配和有针对性的真实安装验证。
**验收：**88入口挂载、state normalize、输入保存失败、卸载、键盘行为。
**原始来源：**[testing-library.com/docs/preact-testing-library/intro/](https://testing-library.com/docs/preact-testing-library/intro/)。

### R50 · 事务测试 — fake-indexeddb

**裁决：优先引入测试域**。
对应位置：`nexus/apps/extension-halo/test`；`nexus/packages/nexus-kernel`。
**由轮子接管：**浅层mock无法模拟事务提交/abort。
**保留自有职责：**真实浏览器upgrade/持久化复验。
**边界与反转条件：**内存实现不替代Chrome磁盘和多进程时序。
**验收：**request成功后abort、upgrade阻塞、冲突事务、孤儿回收。
**原始来源：**[github.com/dumbmatter/fakeIndexedDB](https://github.com/dumbmatter/fakeIndexedDB)。

### R51 · 无障碍自动化 — axe-core / @axe-core/playwright

**裁决：优先补充**。
对应位置：`nexus/apps/extension-halo/test`；`nexus/apps/extension-spectra/test`。
**由轮子接管：**重复通用语义/对比度检测。
**保留自有职责：**真实键盘、焦点、动态交互和人工判断。
**边界与反转条件：**自动规则不能证明全部可访问性；不删除既有业务键盘测试。
**验收：**所有保留面板/主题/语言状态+真实安装场景。
**原始来源：**[playwright.dev/docs/accessibility-testing](https://playwright.dev/docs/accessibility-testing)。

### R52 · SBOM/许可证 — cdxgen / CycloneDX 标准工具

**裁决：治理优先试点**。
对应位置：`nexus/scripts/generate-sbom.ts`；`nexus/scripts/license-adjudication.spec.ts`；`nexus/scripts/capture-retained-dependencies.ts`。
**由轮子接管：**通用包清单和标准格式生成。
**保留自有职责：**实际产物保留依赖、源码衍生代码、许可证裁决与source→ZIP关联。
**边界与反转条件：**cdxgen 支持文本bun.lock；安装图≠产物闭包；固定工具与适当网络权限；别移除真实依赖审计。
**验收：**双lock域、开发依赖区分、owned源码来源、最终ZIP和材料新鲜性。
**原始来源：**[github.com/cdxgen/cdxgen](https://github.com/cdxgen/cdxgen)。

### R53 · GitHub API — @octokit/request + 需要的分页/重试插件

**裁决：治理条件引入**。
对应位置：`nexus/scripts/closeout-evidence.ts`。
**由轮子接管：**通用REST请求、分页、错误类型与退避。
**保留自有职责：**必需workflow集合、attempt语义、SHA/tree/父提交与原子晋升。
**边界与反转条件：**默认重试不能代替幂等设计；写操作不可盲目自动重试；保持凭据不泄漏。
**验收：**分页缺项、限流、认证失败、旧attempt、取消和丢回执。
**原始来源：**[github.com/octokit/request.js](https://github.com/octokit/request.js)。

### R54 · 构建与类型 — 现有Bun/esbuild/Turbo/Biome/TS API

**裁决：保留已有工具，减少自制通用功能**。
对应位置：`nexus/package.json`；`nexus/scripts`；`nexus/apps/extension-halo/build.ts`；`nexus/apps/extension-spectra/build.ts`。
**由轮子接管：**可直接利用现有metafile/AST/脚本owner。
**保留自有职责：**独有发布准入、确定性归档、版本与权限政策。
**边界与反转条件：**不要加入第二formatter或Vite只为现代化；native tsc CLI 与compiler API分域保持。
**验收：**生成入口、产物闭包、路径跨平台、退出码与实际文件后置检查。
**原始来源：**[esbuild.github.io/api/](https://esbuild.github.io/api/)；[biomejs.dev/](https://biomejs.dev/)。

### R55 · 扩展框架 — WXT

**裁决：不在本轮全仓迁移**。
对应位置：`nexus/apps/extension-halo/build.ts`；`nexus/apps/extension-spectra/build.ts`。
**由轮子接管：**新扩展/多浏览器时能减少entry/manifest/build胶水。
**保留自有职责：**现有严密Chrome业务、资源准入与发布链。
**边界与反转条件：**不是没有好框架，而是重平台风险/收益未证明；WXT仍使用原生extension APIs。
**验收：**新原型量化节省+完整原权限/entry/产物/生命周期重放。
**原始来源：**[wxt.dev/guide/introduction.html](https://wxt.dev/guide/introduction.html)。

### R56 · 成熟工具集合参考 — CyberChef / IT-Tools

**裁决：参考实现与依赖选型，不整体嵌入**。
对应位置：`nexus/apps/extension-halo/src/tools/`；`nexus/docs`。
**由轮子接管：**减少重新发现成熟格式库/向量的成本。
**保留自有职责：**自有界面、浏览器权限、预算与本地资料政策。
**边界与反转条件：**应用不是轻量SDK；逐模块复用须许可证/来源证明；其依赖也可能EOL或有公告。
**验收：**提取独立组件后重放语义向量、包体、CSP、无默认外传。
**原始来源：**[github.com/gchq/CyberChef](https://github.com/gchq/CyberChef)；[github.com/corentinth/it-tools](https://github.com/corentinth/it-tools)。

## 所有 HALO 工具目录的处置映射

| 目录 | 决策单元 |
|---|---|
| `api-tester` | R31, R32, R37, R44 |
| `archive` | R26, R30, R39 |
| `base64` | R42 |
| `bookmark-manager` | R39 |
| `checksum` | R19 |
| `clipboard` | R30, R31 |
| `code-formatter` | R03, R06, R07, R08, R09 |
| `code-snippets` | R30, R31 |
| `color-palette` | R24 |
| `color-picker` | R35, R44 |
| `cookie-manager` | R44 |
| `cron` | R29 |
| `crypto` | R16 |
| `csp-analyzer` | R31, R44 |
| `csv-to-json` | R01 |
| `csv-viewer` | R01 |
| `diff` | R28 |
| `dom-selector` | R35, R44 |
| `emoji-picker` | R42 |
| `exif-reader` | R23 |
| `font-inspector` | R35, R44 |
| `gzip` | R25 |
| `hash` | R19 |
| `headers-viewer` | R44 |
| `hex-dump` | R42 |
| `history-search` | R39 |
| `hover-zoom` | R35, R44 |
| `html-entity` | R14 |
| `http-status` | R42 |
| `image-tools` | R24 |
| `ip-lookup` | R21 |
| `json-formatter` | R03, R04 |
| `json-path` | R05 |
| `json-to-csv` | R01 |
| `jwt-decoder` | R16 |
| `lorem-ipsum` | R40 |
| `markdown` | R11, R12 |
| `media-sniffer` | R44 |
| `mock-data` | R40 |
| `morse` | R42 |
| `network` | R21 |
| `number-base` | R42 |
| `outline` | R35, R44 |
| `page-annotate` | R35, R44 |
| `password-gen` | R42 |
| `pdf` | R27, R32 |
| `pomodoro` | R31, R34 |
| `protobuf` | R20 |
| `punycode` | R42 |
| `qrcode` | R45 |
| `random-gen` | R18 |
| `reader-mode` | R12, R13 |
| `regex` | R32 |
| `rot13` | R42 |
| `ruler` | R35, R44 |
| `screenshot` | R44 |
| `session-manager` | R30, R31 |
| `shortcuts` | R36, R44 |
| `smooth-scroll` | R36, R44 |
| `sql-formatter` | R06 |
| `ssl-cert` | R15 |
| `sticky-notes` | R30, R31 |
| `storage-editor` | R44 |
| `subresource` | R19 |
| `tab-group` | R44 |
| `table-extractor` | R01 |
| `tabs` | R44 |
| `tech-stack` | R31, R44 |
| `text-to-speech` | R44 |
| `text-tools` | R42 |
| `timer` | R31, R34 |
| `timestamp` | R42 |
| `todo-list` | R30, R31 |
| `totp` | R17 |
| `translate` | R44 |
| `unit-converter` | R42 |
| `url` | R22, R42 |
| `user-agent` | R41 |
| `uuid` | R18 |
| `xml-formatter` | R10 |
| `xor` | R42 |
| `yaml` | R02, R04 |

## 上游风险与许可证边界

jsrsasign 当前仓库正文宣布2026-08-14终止支持，故不作新X.509方案。检索摘要曾含旧日期，采用打开的当前正文。
UAParser.js v1的MIT不能推及v2；v2需AGPL或对应商业许可裁决。
JSONPath旧实现曾存在代码执行漏洞；无eval和当前公告核验均不可省略。RFC兼容声明需合规集复验，不照抄“100%安全”。
Papa Parse/Prettier/plugin-xml/Floating UI/WXT等项目有MIT许可证声明；yaml为ISC；entities为BSD-2-Clause；Readability为Apache-2.0；DOMPurify提供Apache-2.0或MPL-2.0双许可。实际发布包、NOTICE及全部传递依赖仍需按锁版本验证，README/API识别不是许可证闭包。

## 实施顺序与退出机制

先确定操作语义和失败反例；优先现有库与原生能力，再试点新库；仅在一个真实入口中接入，保留当前正确历史数据；运行原反例、公共向量和集成测试；测生产入口增量而非npm包体；移除旧实现和过期规则；生成真实SBOM和来源材料；锁定版本并推送对应代码。
只需轻量纯适配器，不建立无需求的全插件框架。试点未满足兼容、CSP、资源或许可证条件时，回到候选比较，不放宽业务不变量。
冻结最终候选前持续在现有integration分支追加，不为每个库重写release candidate。新库不自动使86项任务完成；结构解析完成、目标授权正确、迁移完成、实际运行证据分别记录。
