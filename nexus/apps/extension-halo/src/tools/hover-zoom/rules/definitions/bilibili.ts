import { SiteRule, ResolveContext } from '../core';
import {
	PlayinfoResponse,
	BilitvPlayurl,
	extractDashSources,
	extractBilitvSources,
	parseEmbeddedData
} from './bilibili-utils';

export const bilibiliRules: SiteRule[] = [
	// 1. [函数式] B站图片去水印/获取原图
	// 参考 PhotoShow 逻辑：移除 @ 后的缩略图参数，保留查询参数
	// URL 格式: xxx.jpg@672w_378h.avif 或 xxx.jpg@1c.webp?token=xxx
	// 目标: xxx.jpg 或 xxx.jpg?token=xxx
	{
		id: 'bilibili-image',
		hosts: ['hdslb.com', 'bstarstatic.com', 'bilivideo.com'],
		// 匹配包含 @ 的 URL（缩略图参数标志）
		match: /@/,
		resolve: async (ctx: ResolveContext) => {
			const url = ctx.url;
			// 找到 @ 的位置
			const atIndex = url.indexOf('@');
			if (atIndex === -1) return null;

			// 找到 @ 之后的 ? 位置（查询参数开始）
			const queryIndex = url.indexOf('?', atIndex);

			// 移除 @ 到 ? 之间的内容，保留查询参数
			if (queryIndex !== -1) {
				return url.substring(0, atIndex) + url.substring(queryIndex);
			} else {
				// 没有查询参数，直接截断
				return url.substring(0, atIndex);
			}
		}
	},

	// 2. [函数式] 常规视频 (BV号)
	{
		id: 'bilibili-video',
		hosts: ['bilibili.com'],
		match: /bilibili\.com\/video\/(BV\w+)/,
		resolve: async (ctx: ResolveContext) => {
			const videoId = ctx.url.match(/video\/(BV\w+)/)?.[1];
			if (!videoId) return null;

			const infoPageUrl = `https://www.bilibili.com/video/${videoId}`;
			try {
				const html = await ctx.fetchHtml(infoPageUrl);

				// Strategy A: Embedded __playinfo__
				const playinfo = parseEmbeddedData<PlayinfoResponse>(html, '<script>window.__playinfo__={');
				if (playinfo?.data?.dash) {
					return extractDashSources(playinfo.data.dash);
				}

				// Strategy B: API Fallback
				const initState = parseEmbeddedData<{
					videoData?: { cid?: number; bvid?: string };
				}>(html, 'window.__INITIAL_STATE__={');

				if (initState?.videoData?.cid && initState?.videoData?.bvid) {
					const { cid, bvid } = initState.videoData;
					const fnval = ctx.getCookie('CURRENT_FNVAL') || '976';
					const apiUrl = `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&fnval=${fnval}`;

					const apiRes = await ctx.fetchJson<PlayinfoResponse>(apiUrl, { Referer: 'https://www.bilibili.com/' });
					if (apiRes?.data?.dash) {
						return extractDashSources(apiRes.data.dash);
					}
				}
			} catch (e) {
				console.warn('Bilibili resolve failed', e);
			}
			return null;
		}
	},

	// 3. [函数式] 番剧 Episode
	{
		id: 'bilibili-episode',
		hosts: ['bilibili.com'],
		match: /bilibili\.com\/.*\/play\/ep(\d+)/,
		resolve: async (ctx: ResolveContext) => {
			const epId = ctx.url.match(/ep(\d+)/)?.[1];
			if (!epId) return null;

			const apiUrl = `https://api.bilibili.com/pgc/player/web/playurl?fnval=4048&ep_id=${epId}`;
			try {
				const res = await ctx.fetchJson<PlayinfoResponse>(apiUrl, { Referer: 'https://www.bilibili.com/' });
				if (res?.result) {
					return extractDashSources(res.result);
				}
			} catch (e) {
				console.warn('Episode resolve failed', e);
			}
			return null;
		}
	},

	// 4. [函数式] Bilibili TV
	{
		id: 'bilibili-tv',
		hosts: ['bilibili.tv'],
		match: /bilibili\.tv/, // 简单匹配，内部再细分
		resolve: async (ctx: ResolveContext) => {
			let paramName = 'ep_id';
			let id = ctx.url.match(/play\/\d+\/(\d+)/)?.[1];

			if (!id) {
				paramName = 'aid';
				id = ctx.url.match(/video\/(\d+)/)?.[1];
			}

			if (!id) return null;

			const apiUrl = `https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&${paramName}=${id}`;
			try {
				const res = await ctx.fetchJson<{ data?: { playurl?: BilitvPlayurl } }>(apiUrl, {
					'Content-Type': 'application/json'
				});

				if (res?.data?.playurl) {
					return extractBilitvSources(res.data.playurl);
				}
			} catch (e) {
				console.warn('Bilitv resolve failed', e);
			}
			return null;
		}
	}
];
