
import { RuleResult } from '../core';

export interface DashItem {
	bandwidth: number;
	baseUrl?: string;
	base_url?: string;
}

export interface PlayurlDash {
	video?: DashItem[];
	audio?: DashItem[];
}

export interface PlayinfoResponse {
	data?: { dash?: PlayurlDash };
	result?: PlayurlDash;
}

export interface BilitvPlayurl {
	video?: Array<{ video_resource: { url: string; bandwidth: number } }>;
	audio_resource?: Array<{ url: string; bandwidth: number }>;
}

// Sort by bandwidth descending
export const sortByBandwidth = <T extends { bandwidth: number }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => b.bandwidth - a.bandwidth);

/**
 * Extract video+audio URLs from DASH response
 */
export function extractDashSources(dash: PlayurlDash): RuleResult | null {
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
export function extractBilitvSources(playurl: BilitvPlayurl): RuleResult | null {
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
export function parseEmbeddedData<T>(html: string, token: string): T | null {
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
