// goal: Cookie Manager type definitions

export interface CookieInfo {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number | undefined;
	httpOnly: boolean;
	secure: boolean;
	sameSite: string;
}
