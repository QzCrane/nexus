// goal: Reddit image resolution rules
// eff: Convert preview/thumbnail URLs to full-size images

import type { SiteRule } from '../core';

/**
 * Reddit Rules
 * Based on: Hover Zoom+ reddit.js
 *
 * Key patterns:
 * - preview.redd.it → i.redd.it (remove params)
 * - external-preview.redd.it - decode & optimize params
 * - i.reddituploads.com - keep as-is (already full size)
 */
export const redditRules: SiteRule[] = [
	// 1. Preview to full image
	{
		id: 'reddit-preview',
		hosts: ['redd.it', 'reddit.com', 'redditmedia.com'],
		match: /^https?:\/\/(?:preview|i)\.redd\.it\/.+\?/,
		resolve: {
			// Replace preview with i and remove query params
			replace: [/^(https?:\/\/)preview(\.redd\.it\/[^?]+).*/, '$1i$2']
		}
	},

	// 2. External preview - keep params but decode
	{
		id: 'reddit-external-preview',
		hosts: ['redd.it', 'reddit.com'],
		match: /external-preview\.redd\.it/,
		resolve: {
			// Clean up amp encoding
			replace: [/&amp;/g, '&']
		}
	},

	// 3. Reddit gallery images
	{
		id: 'reddit-gallery',
		hosts: ['redd.it', 'reddit.com'],
		match: /preview\.redd\.it\/[a-z0-9]+-[a-z0-9]+\.(jpg|png|gif)/i,
		resolve: {
			replace: [/(preview)(\.redd\.it\/[^?]+).*/, 'i$2']
		}
	},

	// 4. Reddit uploads (already full size, just validate)
	{
		id: 'reddit-uploads',
		hosts: ['reddituploads.com'],
		match: /i\.reddituploads\.com/,
		resolve: async (ctx) => ctx.url || null
	},

	// 5. Reddit video thumbnails (poster images)
	{
		id: 'reddit-video-poster',
		hosts: ['redd.it', 'reddit.com', 'thumbs.redditmedia.com'],
		match: /thumbs\.redditmedia\.com.*\.png$/,
		resolve: async (ctx) => ctx.url || null
	}
];
