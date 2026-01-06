// goal: Imgur image resolution rules
// eff: Convert thumbnail URLs to full-size images

import { SiteRule } from '../core';

/**
 * Imgur Rules
 * Based on: Hover Zoom+ imgur_a.js
 *
 * Key patterns:
 * - Thumbnails: remove size suffix (s, b, t, m, l, h) before extension
 * - i.stack.imgur.com: StackOverflow CDN version
 * - gifv: can be converted to mp4/webm for video playback
 */
export const imgurRules: SiteRule[] = [
	// 1. Standard thumbnails - remove size suffix
	// Example: https://i.imgur.com/ABC123s.jpg → https://i.imgur.com/ABC123.jpg
	{
		id: 'imgur-thumbnail',
		hosts: ['imgur.com', 'i.imgur.com'],
		match: /i\.imgur\.com\/\w+[sbtmlh]\.(jpg|png|gif|webp)/i,
		resolve: {
			replace: [/(\w+)[sbtmlh](\.\w+)$/, '$1$2']
		}
	},

	// 2. StackOverflow's imgur CDN
	{
		id: 'imgur-stackoverflow',
		hosts: ['i.stack.imgur.com'],
		match: /i\.stack\.imgur\.com\/\w+[sbtmlh]\./,
		resolve: {
			replace: [/(\w+)[sbtmlh](\.\w+)$/, '$1$2']
		}
	},

	// 3. gifv to mp4 (for video playback)
	{
		id: 'imgur-gifv',
		hosts: ['imgur.com', 'i.imgur.com'],
		match: /\.gifv$/,
		resolve: {
			replace: [/\.gifv$/, '.mp4']
		}
	},

	// 4. Remove query string dimensions (_d)
	// Example: https://i.imgur.com/ABC123_d.jpg?maxwidth=520 → https://i.imgur.com/ABC123.jpg
	{
		id: 'imgur-dimension-param',
		hosts: ['imgur.com', 'i.imgur.com'],
		match: /_d\.\w+\?/,
		resolve: {
			replace: [/_d(\.\w+)\?.*$/, '$1']
		}
	},

	// 5. Gallery/album thumbnail format
	// Example: https://i.imgur.com/ABC123b.jpg (small) → ABC123.jpg
	{
		id: 'imgur-album-thumb',
		hosts: ['imgur.com', 'i.imgur.com'],
		match: /imgur\.com\/[A-Za-z0-9]+b\.(jpg|png|gif|webp)/i,
		resolve: {
			replace: [/(\w+)b(\.\w+)$/, '$1$2']
		}
	}
];
