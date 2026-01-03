// HALO SaaT: bilibili-plus - B站增强脚本
// Features: 大杯模式(默认最高画质)、去广告、弹幕优化
(function() {
	'use strict';
	
	const LOG_TAG = '[HALO:Bilibili+]';
	
	// ====== 广告移除 ======
	const adStyles = `
		/* 首页/视频页广告 */
		.ad-report, .bili-video-card__info--ad, .video-card-ad-small,
		.pop-live-small-mode, .activity-banner, .eva-banner,
		/* 右侧推广 */
		.right-container .ad-floor, #slide_ad,
		/* 播放页推广 */
		.bilibili-player-dm-tip-wrap, .bpx-player-toast-wrap,
		/* 评论区广告 */
		.comment-list .ad-floor,
		/* 搜索页广告 */
		.activity-game-list, .bili-search-flex-wrap {
			display: none !important;
		}
	`;
	
	function injectStyles(css) {
		const style = document.createElement('style');
		style.textContent = css;
		style.setAttribute('data-halo', 'bilibili-plus');
		(document.head || document.documentElement).appendChild(style);
	}
	
	// ====== 默认最高画质 (大杯模式) ======
	function enableHighestQuality() {
		const qualityObserver = new MutationObserver(() => {
			const qualityBtn = document.querySelector('.bpx-player-ctrl-quality-menu-item:not(.bpx-state-disabled)');
			if (qualityBtn && !sessionStorage.getItem('halo_bili_quality_set')) {
				const items = document.querySelectorAll('.bpx-player-ctrl-quality-menu-item:not(.bpx-state-disabled)');
				if (items.length > 0) {
					items[0].click(); // 点击最高画质
					sessionStorage.setItem('halo_bili_quality_set', '1');
					console.log(LOG_TAG, 'Auto-selected highest quality');
				}
			}
		});
		
		qualityObserver.observe(document.body, { childList: true, subtree: true });
	}
	
	// ====== 自动展开视频简介 ======
	function autoExpandDesc() {
		const expandBtn = document.querySelector('.basic-desc-info.desc-info-btn');
		if (expandBtn) {
			expandBtn.click();
			console.log(LOG_TAG, 'Auto-expanded description');
		}
	}
	
	// ====== 初始化 ======
	function init() {
		console.log(LOG_TAG, 'Initializing...');
		
		// 注入广告屏蔽样式
		injectStyles(adStyles);
		
		// DOM Ready 后执行
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				enableHighestQuality();
				setTimeout(autoExpandDesc, 1500);
			});
		} else {
			enableHighestQuality();
			setTimeout(autoExpandDesc, 1500);
		}
		
		console.log(LOG_TAG, 'Initialized successfully');
	}
	
	init();
})();
