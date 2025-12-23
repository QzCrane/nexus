/**
 * Content Script - SPA 导航观察器
 * 
 * 职责：
 * - 监听 SPA 路由变化 (popstate, pushState, replaceState)
 * - URL 变化时重置 CORS 状态并重新检测
 * 
 * 消耗：极低 (事件驱动，非轮询)
 */

import { isExtensionContextValid } from '../context-guard';
import type { PolicyExecutor } from '../policy-executor';

interface NavigationObserverDeps {
	policyExecutor: PolicyExecutor;
	onNavigate: () => void;  // 导航回调
}

/**
 * 创建 SPA 导航观察器
 * 
 * @returns 清理函数
 */
export function createNavigationObserver(deps: NavigationObserverDeps): () => void {
	const { policyExecutor, onNavigate } = deps;

	let lastPathname = window.location.pathname;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// 防抖处理导航事件
	const handleNavigation = () => {
		if (!isExtensionContextValid()) return;

		const currentPathname = window.location.pathname;

		// 只有路径变化才处理 (忽略 hash 和 query 变化)
		if (currentPathname === lastPathname) return;

		lastPathname = currentPathname;

		// 防抖：300ms 内多次触发只处理一次
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			if (!isExtensionContextValid()) return;

			// 触发 CORS 重新检测
			policyExecutor.probeCors();
			onNavigate();
		}, 300);
	};

	// 监听 popstate (浏览器后退/前进)
	window.addEventListener('popstate', handleNavigation);

	// 拦截 history.pushState
	const originalPushState = history.pushState;
	history.pushState = function (...args) {
		originalPushState.apply(this, args);
		handleNavigation();
	};

	// 拦截 history.replaceState
	const originalReplaceState = history.replaceState;
	history.replaceState = function (...args) {
		originalReplaceState.apply(this, args);
		handleNavigation();
	};

	// 返回清理函数
	return () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		window.removeEventListener('popstate', handleNavigation);
		history.pushState = originalPushState;
		history.replaceState = originalReplaceState;
	};
}
