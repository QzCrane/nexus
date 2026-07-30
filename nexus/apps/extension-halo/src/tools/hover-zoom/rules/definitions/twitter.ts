// goal: Twitter/X image resolution rules
// eff: Convert thumbnail URLs to full-size images

import type { SiteRule } from '../core';

/**
 * Twitter/X Rules
 * Based on: Hover Zoom+ twitter.js + twitter_a.js
 *
 * Key patterns:
 * - Profile images: remove _mini/_normal/_bigger suffix
 * - Media images: replace :thumb/:small with :large or name=large
 * - pbs.twimg.com: append ?format=jpg&name=4096x4096 for best quality
 */
export const twitterRules: SiteRule[] = [
	// 1. Profile images - remove size suffix
	{
		id: 'twitter-profile',
		hosts: ['twitter.com', 'x.com', 'twimg.com'],
		match: /profile_images.*_(mini|normal|bigger)/,
		resolve: {
			replace: [/_(mini|normal|bigger)/, '']
		}
	},

	// 2. Media images - :thumb/:small to :large
	{
		id: 'twitter-media-colon',
		hosts: ['twitter.com', 'x.com', 'twimg.com'],
		match: /twimg\.com\/media.*:(thumb|small)/,
		resolve: {
			replace: [/:(thumb|small)/, ':large']
		}
	},

	// 3. Media images - name=xxx to name=large
	{
		id: 'twitter-media-name',
		hosts: ['twitter.com', 'x.com', 'twimg.com'],
		match: /twimg\.com\/media.*[?&]name=/,
		resolve: {
			replace: [/([?&]name=)[a-z0-9]+/i, '$1large']
		}
	},

	// 4. Card images - convert card_img to full size
	{
		id: 'twitter-card',
		hosts: ['twitter.com', 'x.com', 'twimg.com'],
		match: /twimg\.com\/card_img/,
		resolve: {
			replace: [/\?format=\w+&name=\d+x\d+/, '?format=jpg&name=4096x4096']
		}
	},

	// 5. Tweet video thumbnails (ext_tw_video)
	{
		id: 'twitter-video-thumb',
		hosts: ['twitter.com', 'x.com', 'twimg.com'],
		match: /ext_tw_video\/\d+\/pu\/img/,
		resolve: {
			replace: [/\?.*$/, '']
		}
	},

	// 6. Emoji images - skip (keep original)
	{
		id: 'twitter-emoji-skip',
		hosts: ['twimg.com'],
		match: /\/emoji\//,
		resolve: async () => null // Skip emoji images
	}
];
