// goal: IP Lookup type definitions

export interface IpInfo {
	ip: string;
	hostname?: string;
	city?: string;
	region?: string;
	country?: string;
	loc?: string;
	org?: string;
	timezone?: string;
}
