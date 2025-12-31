// goal: HTTP Status type definitions

export interface HttpStatus {
	code: number;
	name: string;
	description: string;
	category: StatusCategory;
}

export type StatusCategory = 'info' | 'success' | 'redirect' | 'clientError' | 'serverError';
