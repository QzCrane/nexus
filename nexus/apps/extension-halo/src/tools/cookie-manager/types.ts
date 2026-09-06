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
	/** Full cookie identity: host-only cookies must not be rewritten as domain cookies. */
	hostOnly: boolean;
	session: boolean;
	/** Cookie store identity; same name/domain/path can exist in several stores. */
	storeId: string | undefined;
	/** Cookie partition (CHIPS) identity when present. */
	partitionKey: chrome.cookies.CookiePartitionKey | undefined;
}
