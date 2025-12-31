// goal: Crypto tool type definitions

export type CryptoMode = 'jwt' | 'aes' | 'rsa';

export type JWTAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512';

export type AESMode = 'AES-GCM' | 'AES-CBC';
export type AESKeySize = 128 | 192 | 256;

export interface JWTHeader {
	alg: string;
	typ?: string;
	[key: string]: unknown;
}

export interface JWTPayload {
	iss?: string;
	sub?: string;
	aud?: string | string[];
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
	[key: string]: unknown;
}

export interface JWTDecodeResult {
	header: JWTHeader;
	payload: JWTPayload;
	signature: string;
	isValid?: boolean;
	error?: string;
}

export interface AESConfig {
	mode: AESMode;
	keySize: AESKeySize;
}

export interface RSAKeyPair {
	publicKey: string;
	privateKey: string;
}
