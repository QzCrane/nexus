/**
 * 策略执行器 - 兼容层
 * 
 * ⚠️ 已迁移到 ./policy-executor/ 目录
 * 此文件保留仅为向后兼容，请从新路径导入
 * 
 * 新路径: ./policy-executor/index.ts
 */

// 重导出新模块的所有内容
export { createPolicyExecutor } from './policy-executor/index';
export type { PolicyExecutor, PolicyExecutorState, PolicyExecutorDeps } from './policy-executor/index';
