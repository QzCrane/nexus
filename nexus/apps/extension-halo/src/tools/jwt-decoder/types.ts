// goal: JWT Decoder types

export interface JwtParts {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	signature: string;
	isExpired: boolean;
	expiresAt?: Date;
}
