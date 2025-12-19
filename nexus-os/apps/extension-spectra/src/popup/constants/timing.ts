/**
 * SPECTRA Popup - 时间与 UI 尺寸常量
 */

/** 时间常量 (毫秒) */
export const TIMING = {
  /** Capture 初始化等待时间 */
  CAPTURE_INIT_DELAY: 300,
  /** 可视化帧率限制间隔 (~30 FPS) */
  VIZ_FRAME_INTERVAL: 32,
  /** EQ 抽屉动画后更新 metrics */
  EQ_DRAWER_DELAY: 310,
  /** MetricsCache 初始化循环次数 */
  METRICS_INIT_LOOPS: 20,
  /** 按钮反馈显示时间 (如 "OK" 文字) */
  BUTTON_FEEDBACK_DURATION: 1000,
} as const;

/** UI 尺寸常量 (像素) */
export const UI_SIZES = {
  /** 设置页最小高度 - 主 UI 高度不足时展开到此高度 */
  SETTINGS_MIN_HEIGHT: 480,
  /** 可视化条宽度 */
  VIZ_BAR_WIDTH: 3,
  /** 可视化条间隔 */
  VIZ_BAR_GAP: 1,
  /** EQ 曲线线宽 */
  EQ_CURVE_LINE_WIDTH: 2.5,
  /** EQ 曲线阴影模糊 */
  EQ_CURVE_SHADOW_BLUR: 8,
} as const;

/** 可视化绘制参数 */
export const VIZ_PARAMS = {
  /** 条形高度系数 */
  HEIGHT_FACTOR: 0.9,
  /** 最小可见高度 */
  MIN_VISIBLE_HEIGHT: 1,
} as const;
