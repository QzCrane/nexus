
import { SiteRule, ResolveContext, RuleResult } from '../core';

// Sort by bandwidth descending
const sortByBandwidth = <T extends { bandwidth: number }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => b.bandwidth - a.bandwidth);

interface DashItem {
	bandwidth: number;
	baseUrl?: string;
	base_url?: string;
}

interface PlayurlDash {
	video?: DashItem[];
	audio?: DashItem[];
}

interface PlayinfoResponse {
	data?: { dash?: PlayurlDash };
	result?: PlayurlDash;
}

interface BilitvPlayurl {
	video?: Array<{ video_resource: { url: string; bandwidth: number } }>;
	audio_resource?: Array<{ url: string; bandwidth: number }>;
}

/**
 * Extract video+audio URLs from DASH response
 */
function extractDashSources(dash: PlayurlDash): RuleResult | null {
	const videos = (dash.video || []).filter(v => v.baseUrl || v.base_url);
	const audios = (dash.audio || []).filter(a => a.baseUrl || a.base_url);

	if (videos.length === 0) return null;

	sortByBandwidth(videos);
	const videoUrl = videos[0].baseUrl || videos[0].base_url!;

	let audioUrl: string | undefined;
	if (audios.length > 0) {
		sortByBandwidth(audios);
		audioUrl = audios[0].baseUrl || audios[0].base_url;
	}

	return {
		url: videoUrl,
		audioUrl: audioUrl,
		type: 'video',
		headers: { Referer: 'https://www.bilibili.com/' }
	};
}

/**
 * Extract bilibili.tv video+audio URLs
 */
function extractBilitvSources(playurl: BilitvPlayurl): RuleResult | null {
	const videos = (playurl.video || [])
		.map(v => v.video_resource)
		.filter(r => r?.url);
	const audios = (playurl.audio_resource || []).filter(a => a?.url);

	if (videos.length === 0) return null;

	sortByBandwidth(videos);
	const videoUrl = videos[0].url;

	let audioUrl: string | undefined;
	if (audios.length > 0) {
		sortByBandwidth(audios);
		audioUrl = audios[0].url;
	}

	return {
		url: videoUrl,
		audioUrl: audioUrl,
		type: 'video',
		headers: { Referer: 'https://www.bilibili.tv/' }
	};
}

/**
 * Parse embedded script data from HTML
 */
function parseEmbeddedData<T>(html: string, token: string): T | null {
	const idx = html.indexOf(token);
	if (idx === -1) return null;

	const start = idx + token.length - 1;
	let depth = 0;
	let end = start;

	for (let i = start; i < html.length; i++) {
		if (html[i] === '{' || html[i] === '[') depth++;
		else if (html[i] === '}' || html[i] === ']') {
			depth--;
			if (depth === 0) { end = i + 1; break; }
		}
	}

	try {
		return JSON.parse(html.substring(start, end)) as T;
	} catch { return null; }
}

export const bilibiliRules: SiteRule[] = [
	// 1. [声明式] 图片去水印
	{
		id: 'bilibili-image',
		hosts: ['bilibili.com', 'hdslb.com', 'bstarstatic.com'],
		// 匹配 URL 中含 @...webp/jpg/png 结尾的
		match: /@\d+[wq].+/,
		resolve: {
			replace: [/@.+/, '']
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
