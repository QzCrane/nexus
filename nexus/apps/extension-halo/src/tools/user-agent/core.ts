// goal: User-Agent Switcher core logic - UA presets and switching

import type { UserAgentPreset } from './types';

// UA Presets
export const UA_PRESETS: UserAgentPreset[] = [
	{ name: 'Chrome (Windows)', icon: '🪟', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
	{ name: 'Chrome (Mac)', icon: '🍎', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
	{ name: 'Firefox (Windows)', icon: '🦊', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0' },
	{ name: 'Safari (Mac)', icon: '🧭', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
	{ name: 'Edge (Windows)', icon: '🌐', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
	{ name: 'iPhone 15', icon: '📱', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
	{ name: 'iPad Pro', icon: '📱', ua: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
	{ name: 'Android (Pixel)', icon: '🤖', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
	{ name: 'Android (Samsung)', icon: '🤖', ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
	{ name: 'Googlebot', icon: '🤖', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
	{ name: 'Bingbot', icon: '🔍', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
];

// Get current UA
export function getCurrentUserAgent(): string {
	return navigator.userAgent;
}

// Parse UA info
export function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
	let browser = 'Unknown';
	let os = 'Unknown';
	let device = 'Desktop';

	// Browser
	if (ua.includes('Firefox')) browser = 'Firefox';
	else if (ua.includes('Edg')) browser = 'Edge';
	else if (ua.includes('Chrome')) browser = 'Chrome';
	else if (ua.includes('Safari')) browser = 'Safari';

	// OS
	if (ua.includes('Windows')) os = 'Windows';
	else if (ua.includes('Mac OS X')) os = 'macOS';
	else if (ua.includes('Android')) os = 'Android';
	else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
	else if (ua.includes('Linux')) os = 'Linux';

	// Device
	if (ua.includes('Mobile') || ua.includes('iPhone') || ua.includes('Android')) device = 'Mobile';
	else if (ua.includes('iPad') || ua.includes('Tablet')) device = 'Tablet';

	return { browser, os, device };
}
