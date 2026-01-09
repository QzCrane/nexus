import { SiteRule, ResolveContext, RuleResult } from '../core';
import { parseEmbeddedJson, extractJsonFromVar, sortByBandwidth } from '../utils/parse';

// ==========================================
// Bilibili API Types
// ==========================================


interface PlayurlDash {
	video?: Array<{ bandwidth: number; baseUrl?: string; base_url?: string; codecs?: string }>;
	audio?: Array<{ bandwidth: number; baseUrl?: string; base_url?: string; codecs?: string }>;
}

interface BilitvResource {
	url: string;
	bandwidth: number;
}

interface BilitvPlayurl {
	video?: { video_resource: BilitvResource }[];
	audio_resource?: BilitvResource[];
}

interface PlayinfoResponse {
	code: number;
	message: string;
	data?: { dash?: PlayurlDash };
	result?: PlayurlDash;
}

function extractBilibiliDash(dash: PlayurlDash): RuleResult | null {
	let videos = (dash.video || []).filter(v => v.baseUrl || v.base_url);
	if (videos.length === 0) return null;

	videos = sortByBandwidth(videos);
	const video = videos[0];
	const videoUrl = video?.baseUrl || video?.base_url;
	if (!videoUrl) return null;

	let audios = (dash.audio || []).filter(a => a.baseUrl || a.base_url);
	let audioUrl: string | undefined;
	let audioCodec: string | undefined;

	if (audios.length > 0) {
		audios = sortByBandwidth(audios);
		const audio = audios[0];
		audioUrl = audio?.baseUrl || audio?.base_url;
		audioCodec = audio?.codecs;
	}

	return {
		url: videoUrl,
		audioUrl,
		type: 'video',
		// Remove manual Referer to avoid "Refused to set unsafe header" in content script fetch.
		// Browser automatically sets Referer: https://www.bilibili.com/ when hovering on the site.
		metadata: {
			videoCodec: video.codecs,
			audioCodec
		}
	};
}

function extractBilitvSources(playurl: BilitvPlayurl): RuleResult | null {
	let videos = (playurl.video || []).map(v => v.video_resource).filter(r => r?.url);
	if (videos.length === 0) return null;

	videos = sortByBandwidth(videos);
	const videoUrl = videos[0]?.url;
	if (!videoUrl) return null;

	let audios = (playurl.audio_resource || []).filter(a => a?.url);
	let audioUrl: string | undefined;
	if (audios.length > 0) {
		audios = sortByBandwidth(audios);
		audioUrl = audios[0]?.url;
	}

	return { url: videoUrl, audioUrl, type: 'video' };
}

// ==========================================
// Bilibili Rules
// ==========================================


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

	// 2. [函数式] 常规视频 (BV/av号)
	{
		id: 'bilibili-video',
		hosts: ['bilibili.com'],
		// Fix: 兼容 BV 和 av 号
		match: /bilibili\.com\/video\/([Bb][Vv]\w+|[Aa][Vv]\d+)/,
		// 异步触发选择器
		triggers: [
			'a[href*="bilibili.com/video/"]',
			'.bili-video-card__cover',
			'.bili-dyn-card-video__cover',
			'[data-target-url*="bilibili.com/video/"]'
		],
		resolve: async (ctx: ResolveContext) => {
			// Fix: 直接使用原始 URL 以保留 ?p= 参数（多P视频分集）
			try {
				const html = await ctx.fetchHtml(ctx.url);

				// Strategy A: Embedded __playinfo__
				// Use robust extraction matching "window.__playinfo__ = {" (ignoring spaces)
				const playinfo = extractJsonFromVar<PlayinfoResponse>(html, 'window.__playinfo__');
				if (playinfo?.data?.dash) {
					return extractBilibiliDash(playinfo.data.dash);
				}

				// Strategy B: API Fallback
				const initState = extractJsonFromVar<{
					videoData?: { cid?: number; bvid?: string };
				}>(html, 'window.__INITIAL_STATE__');

				if (initState?.videoData?.cid && initState?.videoData?.bvid) {
					const { cid, bvid } = initState.videoData;
					const fnval = ctx.getCookie('CURRENT_FNVAL') || '976';
					const apiUrl = `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&fnval=${fnval}`;

					const apiRes = await ctx.fetchJson<PlayinfoResponse>(apiUrl);
					if (apiRes?.data?.dash) {
						return extractBilibiliDash(apiRes.data.dash);
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
		triggers: [
			'a[href*="bilibili.com"][href*="/play/ep"]',
			'.cardBangumibox .modal-box'
		],
		resolve: async (ctx: ResolveContext) => {
			const epId = ctx.url.match(/ep(\d+)/)?.[1];
			if (!epId) return null;

			const apiUrl = `https://api.bilibili.com/pgc/player/web/playurl?fnval=4048&ep_id=${epId}`;
			try {
				const res = await ctx.fetchJson<PlayinfoResponse>(apiUrl);
				if (res?.result) {
					return extractBilibiliDash(res.result);
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
		triggers: [
			'a[href*="bilibili.tv"][href*="/play/"]',
			'a[href*="bilibili.tv"][href*="/video/"]'
		],
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
	},

	// 5. 用户头像 (hdslb.com/bfs/face/)
	// 参考 HoverZoom+ 逻辑：移除 @ 后的尺寸参数
	{
		id: 'bilibili-avatar',
		hosts: ['hdslb.com'],
		match: /\/bfs\/face\/.*@/,
		resolve: async (ctx: ResolveContext) => {
			// 移除 @ 及其后的尺寸参数 (e.g. @52w_52h.webp)
			return ctx.url.replace(/@[^?]*/, '');
		}
	},

	// 6. BiliGame Wiki 图片
	// 参考 PhotoShow: patchwiki.biligame.com/images/.+?/thumb/
	{
		id: 'biligame-wiki',
		hosts: ['biligame.com'],
		match: /patchwiki\.biligame\.com\/images\/.+\/thumb\//,
		resolve: async (ctx: ResolveContext) => {
			// 移除 /thumb/ 段获取原图
			return ctx.url.replace(/\/thumb\//, '/');
		}
	}
];
