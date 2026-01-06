
// goal: Re-export all rule types and registry
// 避免导出与 core.ts 冲突的类型 (ResolveContext, SiteRule)
export type { ProxyFetchOptions, ProxyAjaxRequest, ProxyAjaxResponse, ZoomResult } from './types';
export * from './core';
export * from './engine';
