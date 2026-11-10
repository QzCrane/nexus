---
type: explanation
status: stable
audience: developer
owner: spectra-pip-readback-root-cause
last_reviewed: 2026-11-02
---

# 抖音画中画「出现后立刻恢复」— 根因排查报告

- **日期**：2026-11-02
- **范围**：SPECTRA 浏览器扩展（`apps/extension-spectra`）的画中画入口、原生写入 ACK 与角标投影
- **现象**：抖音（Douyin）点击画中画后小窗正常出现，随即自动关闭，控制事务报
  `Picture-in-Picture readback mismatch after the stable boundary`。YouTube / Bilibili 不复现。
- **方法**：规范比对（W3C Picture-in-Picture）+ 静态审计（`native-media-executor.ts` 的 `pip` 分支、`writeWithStableEventAck`、`stableReadback`）+ 单元回归夹具（模拟真实浏览器语义）。

---

## 1. 结论先行

**异常环节**：不是浏览器拒绝了画中画，而是**我们自己在同一个任务里把画中画关掉了**。

**根因**：`case 'pip'` 为了绕开站点的 `disablePictureInPicture` 偏好，先把它置 `false`，
`await requestPictureInPicture()`，然后在 `finally` 里**立刻恢复为 `true`**：

```ts
const restoreDisabled = element.disablePictureInPicture;
if (restoreDisabled) element.disablePictureInPicture = false;
try { await element.requestPictureInPicture(); }
finally { if (restoreDisabled) element.disablePictureInPicture = true; }  // ← 凶手
```

[W3C Picture-in-Picture §3.4](https://w3c.github.io/picture-in-picture/#dom-htmlvideoelement-disablepictureinpicture)
规定：当 `disablePictureInPicture` 被**添加到**一个已经是 `pictureInPictureElement` 的
`video` 上时，用户代理 **MAY** 运行「退出画中画」算法。Chrome 实现了这一条。

于是链路变成：小窗出现 → `finally` 把属性设回 `true` → Chrome 退出画中画 →
64 ms 事件静默窗 + 2 帧稳定边界后 `stableReadback` 读到
`document.pictureInPictureElement === null` → 抛出「readback mismatch」。

**只有抖音中招**，因为只有它在 `video` 上设了 `disablePictureInPicture`；
YouTube / Bilibili 上 `restoreDisabled === false`，整段不执行。

**为什么既有测试是绿的**：冒烟夹具只模拟了「属性为 `true` 时 `requestPictureInPicture`
被拒绝」，**没有模拟「属性被重新添加时 UA 退出画中画」**。夹具比浏览器宽容，
所以它证明的是夹具自己的假设。

---

## 2. 同一条链路上的附带缺陷

| 缺陷 | 位置 | 后果 |
| --- | --- | --- |
| 退出他人 PiP 不判断 owner | `toggleTrustedActivation` 的 `!requested` 分支 | 抖音 feed 多个 video 时，点 B 会先把 A 退出 |
| Popup 传入的 `target` 被丢弃 | `trusted-activation-bridge.ts` → `submitTrustedActivationControl('pip')` | Popup 选中 B，content 可能操作 A |

两者都不改变本报告的根因，但都会让「点画中画」在真实 feed 上表现为「开错视频 / 关掉别的视频」，
因此与根因一起修复。

---

## 3. 修复

### 3.1 属性所有权（`SCTRL-051`）

站点策略属性在**会话存续期间由扩展持有**，会话结束才归还：

- `holdPictureInPictureDisable(element)`：接管被抬起的属性，只在
  `leavepictureinpicture` 或元素异步状态清理时恢复；重复调用幂等。
- `releasePictureInPictureDisable(element)`：如果这个元素仍是
  `pictureInPictureElement`，**拒绝恢复**——恢复它等于请求浏览器关闭我们刚打开的窗口。
- `requestPictureInPicture()` 失败时立即恢复站点偏好：没有会话，就没有需要保护的东西。

### 3.2 否决分类

站点终止会话是**策略事实**，不是读回不一致：`PictureInPictureVetoedError` →
`policy-denied` / `retryable: false`。重试只会重复「打开又关闭」。

### 3.3 目标透传

`submitTrustedActivationControl(field, documentId?, target?)` 把 Popup 的 target 一路带到
`executor.toggleTrustedActivation(field, target)`，Popup 选中哪个 video 就操作哪个。

### 3.4 夹具升级

`test/smoke/popup-ui.spec.ts` 的 PiP 夹具改用 `Object.defineProperty` 定义
`disablePictureInPicture` 的 getter/setter，setter 在
`value === true && document.pictureInPictureElement === fixtureVideo` 时调用
`document.exitPictureInPicture()`——即真实浏览器的行为。

单元层（`test/native-media-executor.spec.ts`）新增
`holds the lifted disablePictureInPicture until the PiP session ends`：
把 `holdPictureInPictureDisable(element)` 换回 `element.disablePictureInPicture = true`
时该测试变红，恢复后变绿。这就是本次回归向量的锚点。

---

## 4. 与延迟问题的关系

修复 PiP 时确认了第二个独立缺陷：`canSplitAck` 把 `field !== 'speed'` 和
`mediaWriter === 'dom-native'` 写死，于是 `playing` / `pip` / `fullscreen` / `speed`
全部要等 64 ms 静默窗 + 2 帧才作答（≈100–130 ms），抖音倍速还叠加每次读回重跑的
控制器扫描（18 层祖先 × 288 属性 × 8 层原型 + 24 层祖先 × 4096 文本节点）。

`SCTRL-045` 早已声明「物理写入与稳定化证明是两个不同事实」，实现却落后于自己的不变式。
本次把 `playing` / `pip` / `fullscreen` / DOM `speed` 改为**写入即 ACK + 后台证明**，
并把控制器发现结果按 `currentSrc` + 2 s TTL 缓存（写失败立即失效）。

page-controller 的 `speed` 写入**仍然 awaited**：控制器声称支持某速率却从不真正播放，
与「控制器 150 ms 后才生效」在同步视角下不可区分，只有 awaited settle 窗能分辨并降级到
DOM writer。放弃这条等于静默移除一个能力回退路径
（`test/native-media-executor.spec.ts`："falls back for a free speed the controller claims
but never plays"）。

---

## 5. 证据边界

- 规范依据来自 W3C Picture-in-Picture §3.4 原文；Chrome 的具体实现行为由夹具模拟，
  未在真实 douyin.com 上二次复核（本次会话未执行实机验证）。
- 单元测试与 `bun scripts/verify-architecture.ts` 全绿；Chrome 冒烟夹具
  （`test/smoke/popup-ui.spec.ts`）在本分支存在一个**既有失败**（`No active video target`，
  与本次改动无关，已在干净树上复现），因此 PiP 的回归证据落在单元层。
