// goal: HTTP Status core logic - status code database

import type { HttpStatus, StatusCategory } from './types';

export const HTTP_STATUSES: HttpStatus[] = [
	// 1xx Informational
	{ code: 100, name: 'Continue', description: 'Server received headers, client should proceed', category: 'info' },
	{ code: 101, name: 'Switching Protocols', description: 'Server is switching protocols', category: 'info' },
	{ code: 102, name: 'Processing', description: 'Server is processing the request', category: 'info' },
	{ code: 103, name: 'Early Hints', description: 'Used to return some response headers early', category: 'info' },

	// 2xx Success
	{ code: 200, name: 'OK', description: 'Request succeeded', category: 'success' },
	{ code: 201, name: 'Created', description: 'Resource was successfully created', category: 'success' },
	{ code: 202, name: 'Accepted', description: 'Request accepted for processing', category: 'success' },
	{ code: 204, name: 'No Content', description: 'Success but no content returned', category: 'success' },
	{ code: 206, name: 'Partial Content', description: 'Partial resource returned', category: 'success' },

	// 3xx Redirection
	{ code: 301, name: 'Moved Permanently', description: 'Resource permanently moved', category: 'redirect' },
	{ code: 302, name: 'Found', description: 'Resource temporarily moved', category: 'redirect' },
	{ code: 304, name: 'Not Modified', description: 'Resource not modified since last request', category: 'redirect' },
	{ code: 307, name: 'Temporary Redirect', description: 'Temporary redirect, method preserved', category: 'redirect' },
	{ code: 308, name: 'Permanent Redirect', description: 'Permanent redirect, method preserved', category: 'redirect' },

	// 4xx Client Errors
	{ code: 400, name: 'Bad Request', description: 'Server cannot process the request', category: 'clientError' },
	{ code: 401, name: 'Unauthorized', description: 'Authentication required', category: 'clientError' },
	{ code: 403, name: 'Forbidden', description: 'Server refuses to authorize', category: 'clientError' },
	{ code: 404, name: 'Not Found', description: 'Resource not found', category: 'clientError' },
	{ code: 405, name: 'Method Not Allowed', description: 'HTTP method not allowed', category: 'clientError' },
	{ code: 408, name: 'Request Timeout', description: 'Server timed out waiting', category: 'clientError' },
	{ code: 409, name: 'Conflict', description: 'Request conflicts with current state', category: 'clientError' },
	{ code: 410, name: 'Gone', description: 'Resource no longer available', category: 'clientError' },
	{ code: 413, name: 'Payload Too Large', description: 'Request entity too large', category: 'clientError' },
	{ code: 415, name: 'Unsupported Media Type', description: 'Media type not supported', category: 'clientError' },
	{ code: 422, name: 'Unprocessable Entity', description: 'Semantic errors in request', category: 'clientError' },
	{ code: 429, name: 'Too Many Requests', description: 'Rate limit exceeded', category: 'clientError' },

	// 5xx Server Errors
	{ code: 500, name: 'Internal Server Error', description: 'Unexpected server error', category: 'serverError' },
	{ code: 501, name: 'Not Implemented', description: 'Server does not support request', category: 'serverError' },
	{ code: 502, name: 'Bad Gateway', description: 'Invalid response from upstream', category: 'serverError' },
	{ code: 503, name: 'Service Unavailable', description: 'Server temporarily unavailable', category: 'serverError' },
	{ code: 504, name: 'Gateway Timeout', description: 'Upstream server timed out', category: 'serverError' },
];

export const CATEGORY_INFO: Record<StatusCategory, { label: string; color: string; icon: string }> = {
	info: { label: '1xx Informational', color: '#6366f1', icon: 'ℹ️' },
	success: { label: '2xx Success', color: '#22c55e', icon: '✅' },
	redirect: { label: '3xx Redirection', color: '#f59e0b', icon: '↪️' },
	clientError: { label: '4xx Client Error', color: '#ef4444', icon: '⚠️' },
	serverError: { label: '5xx Server Error', color: '#dc2626', icon: '❌' },
};

// Search statuses
export function searchStatuses(query: string): HttpStatus[] {
	const q = query.toLowerCase().trim();
	if (!q) return HTTP_STATUSES;
	return HTTP_STATUSES.filter((s) =>
		s.code.toString().includes(q) ||
		s.name.toLowerCase().includes(q) ||
		s.description.toLowerCase().includes(q)
	);
}
