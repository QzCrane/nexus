// goal: Type definitions for api-tester tool

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface Header {
	id: string;
	key: string;
	value: string;
	enabled: boolean;
}

export interface RequestConfig {
	method: HttpMethod;
	url: string;
	headers: Header[];
	body: string;
	bodyType: 'none' | 'json' | 'form' | 'text';
}

export interface ResponseData {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
	time: number;
	size: number;
}

export interface SavedRequest {
	id: string;
	name: string;
	config: RequestConfig;
	createdAt: number;
}
