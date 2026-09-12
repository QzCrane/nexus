import type { SiteRule, ResolveContext, RuleResult } from '../core';
import { extractJsonFromVar, sortByBandwidth } from '../utils/parse';

// ==========================================
// Bilibili API Types
// ==========================================

interface VideoStream {
	bandwidth: number;
	baseUrl?: string;
	base_url?: string;
	codecs?: string;
	width?: number;
	height?: number;
}

interface PlayurlDash {
	video?: VideoStream[];
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

/**
 * Select best video stream based on target display height
 * If targetHeight provided: pick smallest stream >= targetHeight (or largest if none match)
 * If no targetHeight: pick highest bandwidth (original behavior)
 */
function selectVideoStream(videos: VideoStream[], targetHeight?: number): VideoStream | null {
	if (videos.length === 0) return null;

	// Sort by height ascending for selection
	const sorted = [...videos].sort((a, b) => (a.height || 0) - (b.height || 0));

	if (targetHeight && targetHeight > 0) {
		// Find smallest stream >= targetHeight
		const match = sorted.find(v => (v.height || 0) >= targetHeight);
		if (match) return match;
		// Fallback to largest if none >= target
		return sorted[sorted.length - 1] ?? null;
	}

	// No target: use highest bandwidth (original behavior)
	return sortByBandwidth(videos)[0] ?? null;
}

function extractBilibiliDash(dash: PlayurlDash, targetHeight?: number): RuleResult | null {
	const videos = (dash.video || []).filter(v => v.baseUrl || v.base_url);
	if (videos.length === 0) return null;

	const video = selectVideoStream(videos, targetHeight);
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

	console.log('[Bilibili] Selected quality:', video?.height, 'p, target:', targetHeight);

	return {
		url: videoUrl,
		audioUrl,
		type: 'video',
		headers: { Referer: 'https://www.bilibili.com/' },
		metadata: {
			videoCodec: video?.codecs,
			audioCodec,
			width: video?.width,
			height: video?.height
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
	// 1. B站图片原图 - 简单移除 @ 后缀
	// xxx.jpg@672w_378h.avif → xxx.jpg
	{
		id: 'bilibili-image',
		hosts: ['hdslb.com', 'bstarstatic.com', 'bilivideo.com', 'biliimg.com'],
		match: /@/,
		resolve: async (ctx: ResolveContext) => {
			const atIndex = ctx.url.indexOf('@');
			if (atIndex !== -1) {
				const result = ctx.url.substring(0, atIndex);
				console.log('[Bilibili] HD:', ctx.url.slice(-40), '→', result.slice(-40));
				return result;
			}
			return null;
		}
	},

	// 2. [函数式] 常规视频 (BV/av号)
	{
		id: 'bilibili-video',
		proxyCapability: 'bilibili-main',
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
					return extractBilibiliDash(playinfo.data.dash, ctx.targetHeight);
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
						return extractBilibiliDash(apiRes.data.dash, ctx.targetHeight);
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
		proxyCapability: 'bilibili-main',
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
					return extractBilibiliDash(res.result, ctx.targetHeight);
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
		proxyCapability: 'bilibili-tv',
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
