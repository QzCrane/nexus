// goal: HD URL transformation rules for popular websites
// eff: Pattern-based URL upgrading for better image quality

export interface HdRule {
	pattern: RegExp;
	replacement: string | ((match: RegExpMatchArray) => string);
}

export const HD_RULES: HdRule[] = [
	// Bilibili hdslb.com - multiple patterns for comprehensive coverage
	// Pattern 1: URL with file extension followed by @ suffix
	// Sample: https://i2.hdslb.com/bfs/face/xxx.jpg@52w_52h.webp -> xxx.jpg
	{ pattern: /(.+?\.(?:jpg|jpeg|png|gif|webp))@.+$/i, replacement: '$1' },
	// Pattern 2: URL without extension but with @ suffix (Bilibili archive covers)
	// Sample: https://i0.hdslb.com/bfs/archive/xxx@320w_200h -> xxx
	{ pattern: /(hdslb\.com\/bfs\/[^@]+)@.+$/i, replacement: '$1' },
	// Pattern 3: bstarstatic.com (same as hdslb)
	{ pattern: /(bstarstatic\.com\/[^@]+)@.+$/i, replacement: '$1' },
	// Weibo
	{ pattern: /\/thumb\d+\//, replacement: '/large/' },
	{ pattern: /\.sinaimg\.cn\/[a-z]+\//, replacement: '.sinaimg.cn/large/' },
	// Zhihu
	{ pattern: /_[a-z]+\.(jpg|png|webp)$/i, replacement: '.$1' },
	{ pattern: /\?source=.*$/, replacement: '' },
	// Douban
	{ pattern: /\/s_ratio_poster\//, replacement: '/l_ratio_poster/' },
	{ pattern: /\/view\/photo\/[a-z]+\//, replacement: '/view/photo/raw/' },
	// Twitter/X
	{ pattern: /&name=[a-z]+$/i, replacement: '&name=orig' },
	{ pattern: /\?format=([a-z]+)&name=[a-z]+$/i, replacement: '?format=$1&name=orig' },
	// Instagram
	{ pattern: /\/s\d+x\d+\//, replacement: '/' },
	// Reddit
	{ pattern: /preview\.redd\.it/, replacement: 'i.redd.it' },
	// Imgur - only match i.imgur.com URLs
	{ pattern: /i\.imgur\.com\/([a-zA-Z0-9]+)[a-z]\.(jpg|png|gif)$/i, replacement: 'i.imgur.com/$1.$2' },
	// Pinterest
	{ pattern: /\/\d+x\//, replacement: '/originals/' },
	// Pixiv
	{ pattern: /\/c\/\d+x\d+[^/]*\//, replacement: '/' },
	{ pattern: /_master\d+/, replacement: '' },
	// ArtStation
	{ pattern: /\/small_square\//, replacement: '/large/' },
	// Generic thumbnail patterns
	{ pattern: /-\d+x\d+\.(jpg|png|webp)$/i, replacement: '.$1' },
	{ pattern: /_thumb\.(jpg|png|webp)$/i, replacement: '.$1' },
];

/**
 * Apply HD rules to upgrade thumbnail URL
 */
export function applyHdRules(url: string): string {
	for (const rule of HD_RULES) {
		if (rule.pattern.test(url)) {
			if (typeof rule.replacement === 'string') {
				return url.replace(rule.pattern, rule.replacement);
			}
			const match = url.match(rule.pattern);
			if (match) return rule.replacement(match);
		}
	}
	return url;
}
