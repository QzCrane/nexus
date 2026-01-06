// goal: Bilibili site rule for Hover Zoom
// eff: Ported from HoverZoom+ bilibili_a.js (MIT), modernized without jQuery
// Handles: Regular videos (/video/BVxxx), Episodes (/play/epXXX), bilibili.tv

import type { SiteRule, ResolveContext, ZoomResult } from '../types';

// Sort by bandwidth descending
const sortByBandwidth = <T extends { bandwidth: number }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => b.bandwidth - a.bandwidth);

// Bilibili DASH stream item
interface DashItem {
	bandwidth: number;
	baseUrl?: string;
	base_url?: string;
}

// Bilibili playurl response structures
interface PlayurlDash {
	video?: DashItem[];
	audio?: DashItem[];
}

interface PlayinfoData {
	dash?: PlayurlDash;
}

interface PlayinfoResponse {
	data?: PlayinfoData;
	result?: PlayurlDash; // PGC API uses result instead of data.dash
}

// bilibili.tv API response structure
interface BilitvPlayurl {
	video?: Array<{ video_resource: { url: string; bandwidth: number } }>;
	audio_resource?: Array<{ url: string; bandwidth: number }>;
}

interface BilitvResponse {
	data?: { playurl?: BilitvPlayurl };
}

/**
 * Extract video+audio URLs from DASH response
 */
function extractDashSources(dash: PlayurlDash): [string, string | undefined] | null {
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

	return [videoUrl, audioUrl];
}

/**
 * Extract bilibili.tv video+audio URLs
 */
function extractBilitvSources(playurl: BilitvPlayurl): [string, string | undefined] | null {
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

	return [videoUrl, audioUrl];
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

// =============== Resolver Functions ===============

async function resolveVideo(
	videoId: string,
	fetchWithProxy: ResolveContext['fetchWithProxy'],
	getCookie: ResolveContext['getCookie']
): Promise<ZoomResult | null> {
	const pageUrl = `https://www.bilibili.com/video/${videoId}`;

	try {
		const html = await fetchWithProxy<string>(pageUrl, { responseType: 'text' });

		// Try embedded __playinfo__
		const playinfo = parseEmbeddedData<PlayinfoResponse>(html, '<script>window.__playinfo__={');
		if (playinfo?.data?.dash) {
			const sources = extractDashSources(playinfo.data.dash);
			if (sources) {
				return {
					type: 'video',
					sources: [sources[0]],
					audioUrl: sources[1],
					headers: { Referer: 'https://www.bilibili.com/' }
				};
			}
		}

		// Fallback: Extract cid/bvid from __INITIAL_STATE__ and call API
		const initState = parseEmbeddedData<{
			videoData?: { cid?: number; bvid?: string };
		}>(html, 'window.__INITIAL_STATE__={');

		if (initState?.videoData?.cid && initState?.videoData?.bvid) {
			const { cid, bvid } = initState.videoData;
			const fnval = getCookie('CURRENT_FNVAL') || '976';
			const apiUrl = `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&fnval=${fnval}`;

			const apiRes = await fetchWithProxy<PlayinfoResponse>(apiUrl, {
				headers: { Referer: 'https://www.bilibili.com/' }
			});

			if (apiRes?.data?.dash) {
				const sources = extractDashSources(apiRes.data.dash);
				if (sources) {
					return {
						type: 'video',
						sources: [sources[0]],
						audioUrl: sources[1],
						headers: { Referer: 'https://www.bilibili.com/' }
					};
				}
			}
		}
	} catch (e) {
		console.warn('[HoverZoom:Bilibili] Failed to resolve video:', e);
	}

	return null;
}

async function resolveEpisode(
	episodeId: string,
	fetchWithProxy: ResolveContext['fetchWithProxy']
): Promise<ZoomResult | null> {
	const apiUrl = `https://api.bilibili.com/pgc/player/web/playurl?fnval=4048&ep_id=${episodeId}`;

	try {
		const res = await fetchWithProxy<PlayinfoResponse>(apiUrl, {
			headers: { Referer: 'https://www.bilibili.com/' }
		});

		if (res?.result) {
			const sources = extractDashSources(res.result);
			if (sources) {
				return {
					type: 'video',
					sources: [sources[0]],
					audioUrl: sources[1],
					headers: { Referer: 'https://www.bilibili.com/' }
				};
			}
		}
	} catch (e) {
		console.warn('[HoverZoom:Bilibili] Failed to resolve episode:', e);
	}

	return null;
}

async function resolveBilitv(
	paramName: 'ep_id' | 'aid',
	id: string,
	fetchWithProxy: ResolveContext['fetchWithProxy']
): Promise<ZoomResult | null> {
	const apiUrl = `https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&${paramName}=${id}`;

	try {
		const res = await fetchWithProxy<BilitvResponse>(apiUrl, {
			headers: { 'Content-Type': 'application/json' }
		});

		if (res?.data?.playurl) {
			const sources = extractBilitvSources(res.data.playurl);
			if (sources) {
				return {
					type: 'video',
					sources: [sources[0]],
					audioUrl: sources[1],
					headers: { Referer: 'https://www.bilibili.tv/' }
				};
			}
		}
	} catch (e) {
		console.warn('[HoverZoom:Bilibili] Failed to resolve bilibili.tv:', e);
	}

	return null;
}

// =============== Rule Export ===============

export const bilibiliRule: SiteRule = {
	id: 'bilibili',
	name: 'Bilibili',
	version: '1.0.0',
	priority: 100,

	matches: (host) => /bilibili\.(com|tv)$/i.test(host),

	probe: 'a[href*="/video/"], a[href*="/play/"], a[data-target-url]',

	async resolve(ctx: ResolveContext): Promise<ZoomResult | null> {
		const { element, fetchWithProxy, getCookie } = ctx;

		// Get href from link or data-target-url
		const link = element.closest('a');
		const href = link?.href || (link as HTMLElement | null)?.dataset?.targetUrl || '';
		if (!href) return null;

		// Case 1: bilibili.com/video/BVxxx
		const videoMatch = href.match(/bilibili\.com\/video\/([^/?]+)/);
		if (videoMatch) {
			return resolveVideo(videoMatch[1], fetchWithProxy, getCookie);
		}

		// Case 2: bilibili.com episode (/bangumi/play/epXXX)
		const epMatch = href.match(/bilibili\.com\/.*\/play\/ep(\d+)/);
		if (epMatch) {
			return resolveEpisode(epMatch[1], fetchWithProxy);
		}

		// Case 3: bilibili.tv/play/series/episode
		const bilitvSeriesMatch = href.match(/bilibili\.tv.*\/play\/\d+\/(\d+)/);
		if (bilitvSeriesMatch) {
			return resolveBilitv('ep_id', bilitvSeriesMatch[1], fetchWithProxy);
		}

		// Case 4: bilibili.tv/video/XXX
		const bilitvVideoMatch = href.match(/bilibili\.tv.*\/video\/(\d+)/);
		if (bilitvVideoMatch) {
			return resolveBilitv('aid', bilitvVideoMatch[1], fetchWithProxy);
		}

		return null;
	}
};

export default bilibiliRule;
