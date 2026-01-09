# Bilibili Danmaku (弹幕) 功能规划 - Phase 5

> 创建: 2026-01-09 | 状态: 规划中

## 概述

为 Hover Zoom 视频预览添加 B 站弹幕支持，实现完整的视频预览体验。

---

## 技术调研

### B 站弹幕 API

**v2 API (推荐 - 分段请求)**:

```
GET https://api.bilibili.com/x/v2/dm/web/seg.so?oid={cid}&segment_index=1&type=1
Response: Protobuf (DmSegMobileReply)
```

**v1 API (旧版 XML)**:

```
GET https://api.bilibili.com/x/v1/dm/list.so?oid={cid}
Response: XML (压缩)
```

### Protobuf 解析

B 站弹幕使用 Protobuf 格式，主要结构：

```protobuf
message DmSegMobileReply {
  repeated DanmakuElem elems = 1;
}

message DanmakuElem {
  int64 id = 1;          // 弹幕 ID
  int32 progress = 2;    // 时间戳 (ms)
  int32 mode = 3;        // 模式 (1滚动 4底部 5顶部)
  int32 fontsize = 4;    // 字号 (18/25/36)
  uint32 color = 5;      // 颜色 (RGB)
  string midHash = 6;    // 用户哈希
  string content = 7;    // 弹幕内容
  int64 ctime = 8;       // 发送时间
  int32 weight = 9;      // 权重 (屏蔽等级)
  string action = 10;    // 动作
  int32 pool = 11;       // 弹幕池 (0普通 1字幕 2特殊)
}
```

### 渲染方案

| 方案              | 优点               | 缺点           |
| ----------------- | ------------------ | -------------- |
| **Canvas 覆盖层** | 性能最佳、控制精细 | 实现复杂       |
| CSS Animation     | 实现简单           | 大量弹幕时卡顿 |
| WebGL             | 极致性能           | 过度工程       |

**推荐: Canvas 覆盖层**

---

## 架构设计

```
hover-zoom/
├── viewer/
│   ├── danmaku/
│   │   ├── index.ts          # Re-exports
│   │   ├── types.ts          # Danmaku types
│   │   ├── proto-decoder.ts  # (≤200L) Protobuf → DanmakuItem[]
│   │   ├── canvas-renderer.ts# (≤200L) Canvas 渲染 + 碰撞检测
│   │   └── controller.ts     # (≤200L) 时间轴同步 + 用户控制
│   └── media-display.ts      # 集成弹幕层
└── rules/
    └── definitions/bilibili.ts # 扩展返回 cid (用于弹幕 API)
```

### 核心接口

```typescript
interface DanmakuItem {
  id: string;
  time: number; // 出现时间 (ms)
  mode: "scroll" | "top" | "bottom";
  fontSize: number;
  color: string; // #RRGGBB
  content: string;
}

interface DanmakuController {
  load(cid: number): Promise<void>;
  attach(video: HTMLVideoElement, container: HTMLElement): void;
  detach(): void;
  toggle(): void; // 开关弹幕
  setOpacity(val: number): void;
  setSpeed(val: number): void;
}
```

---

## 实现步骤

### Step 1: Protobuf 解码器 (proto-decoder.ts)

**策略**: 手动解码 Protobuf (避免引入 protobuf.js 依赖)

- Varint 解码
- 字段解析 (wire type 0/2)
- 返回 `DanmakuItem[]`

### Step 2: Canvas 渲染器 (canvas-renderer.ts)

**核心功能**:

- Canvas 尺寸自适应视频
- 弹幕轨道分配 (碰撞检测)
- 滚动动画 (requestAnimationFrame)
- 顶部/底部弹幕定时消失

**性能优化**:

- 仅渲染可见时间窗口弹幕
- 复用文字测量缓存
- 脏区域重绘

### Step 3: 控制器 (controller.ts)

**功能**:

- 与 video.currentTime 同步
- 暂停/播放时停止/恢复
- 用户设置 (透明度/速度/开关)

### Step 4: 集成

- 修改 `bilibili.ts` 返回 `cid` 用于弹幕请求
- 修改 `media-display.ts` 初始化弹幕层
- 添加设置项 (danmaku: enable/opacity/speed)

---

## 设置项

```typescript
interface DanmakuSettings {
  enable: boolean; // 默认 true
  opacity: number; // 0-1, 默认 0.8
  speed: number; // 0.5-2, 默认 1
  fontSize: number; // 0.5-2, 默认 1 (倍率)
  area: number; // 0.25-1, 默认 0.5 (屏幕占比)
}
```

---

## 风险 & 挑战

1. **Protobuf 手动解码** - 需测试边界情况
2. **大量弹幕性能** - 需限流 (如最多显示 100 条/秒)
3. **视频尺寸变化** - Canvas 需重新调整
4. **跨域请求** - 需通过 Background Proxy

---

## 工作量估计

| 模块               | 估计时间 |
| ------------------ | -------- |
| proto-decoder.ts   | 2h       |
| canvas-renderer.ts | 4h       |
| controller.ts      | 2h       |
| 集成 + 测试        | 2h       |
| **总计**           | **~10h** |

---

## 依赖

- **无新增运行时依赖** (手动解析 Protobuf)
- 复用现有 Background Proxy 获取弹幕数据

---

## 验收标准

- [ ] 弹幕与视频时间轴同步
- [ ] 滚动/顶部/底部弹幕正确显示
- [ ] 弹幕颜色/字号正确
- [ ] 开关/透明度/速度设置生效
- [ ] 性能: 1000 条弹幕流畅 (60fps)
- [ ] 视频暂停时弹幕暂停
