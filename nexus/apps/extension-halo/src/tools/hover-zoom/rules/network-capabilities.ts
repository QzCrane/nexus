// goal: Declarative network capabilities for Hover Zoom rules. The rule and
// background proxy consume the same data so a resolver cannot mint broader
// network authority in a message.

export const HOVER_ZOOM_PROXY_CAPABILITIES = {
	'bilibili-main': {
		sourceHosts: ['bilibili.com'],
		targetHosts: ['bilibili.com', 'bilivideo.com', 'bilivideo.cn'],
		methods: ['GET'],
		headers: ['referer', 'range'],
	},
	'bilibili-tv': {
		sourceHosts: ['bilibili.tv'],
		targetHosts: ['bilibili.tv', 'bstarstatic.com'],
		methods: ['GET'],
		headers: ['content-type', 'range'],
	},
} as const;

export type HoverZoomProxyCapability = keyof typeof HOVER_ZOOM_PROXY_CAPABILITIES;

function matchesHost(host: string, suffixes: readonly string[]): boolean {
	const lower = host.toLowerCase();
	return suffixes.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

export function admitsHoverZoomProxyRequest(
	capability: HoverZoomProxyCapability,
	source: URL,
	target: URL,
	method: string,
	headerNames: Iterable<string>,
): boolean {
	const policy = HOVER_ZOOM_PROXY_CAPABILITIES[capability];
	return matchesHost(source.hostname, policy.sourceHosts)
		&& matchesHost(target.hostname, policy.targetHosts)
		&& (policy.methods as readonly string[]).includes(method.toUpperCase())
		&& [...headerNames].every((name) => (policy.headers as readonly string[]).includes(name.toLowerCase()));
}

export function isHoverZoomProxyCapability(value: unknown): value is HoverZoomProxyCapability {
	return typeof value === 'string' && Object.hasOwn(HOVER_ZOOM_PROXY_CAPABILITIES, value);
}
