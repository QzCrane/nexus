// goal: Network utility type definitions

export type NetworkMode = 'ua-parser' | 'curl-converter';

export interface UAResult {
	browser: { name: string; version: string };
	os: { name: string; version: string };
	device: { type: string; vendor: string; model: string };
	engine: { name: string; version: string };
}

export interface CurlParseResult {
	method: string;
	url: string;
	headers: Record<string, string>;
	data?: string;
}
