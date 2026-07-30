// goal: Crypto core logic using jose library
// eff: JWT decode/encode/verify, AES encrypt/decrypt, RSA key generation

import * as jose from 'jose';
import type { JWTDecodeResult, AESMode, AESKeySize, RSAKeyPair } from './types';

// === JWT Operations ===

function splitJWT(token: string): [string, string, string] {
	const [header, payload, signature, extra] = token.split('.');
	if (
		header === undefined
		|| payload === undefined
		|| signature === undefined
		|| extra !== undefined
	) {
		throw new Error('Invalid JWT format');
	}
	return [header, payload, signature];
}

// Decode JWT without verification (base64 parsing only)
export function decodeJWT(token: string): JWTDecodeResult {
	try {
		const [headerPart, payloadPart, signature] = splitJWT(token);

		const header = JSON.parse(atob(headerPart.replace(/-/g, '+').replace(/_/g, '/')));
		const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));

		return { header, payload, signature };
	} catch (error) {
		return {
			header: { alg: 'unknown' },
			payload: {},
			signature: '',
			error: error instanceof Error ? error.message : 'Decode failed',
		};
	}
}

// Verify JWT with HMAC secret
export async function verifyJWTHS(token: string, secret: string): Promise<JWTDecodeResult> {
	try {
		const secretKey = new TextEncoder().encode(secret);
		const { protectedHeader, payload } = await jose.jwtVerify(token, secretKey);
		const [, , signature] = splitJWT(token);
		return {
			header: protectedHeader as JWTDecodeResult['header'],
			payload: payload as JWTDecodeResult['payload'],
			signature,
			isValid: true,
		};
	} catch (error) {
		const decoded = decodeJWT(token);
		return { ...decoded, isValid: false, error: error instanceof Error ? error.message : 'Verify failed' };
	}
}

// Create JWT with HMAC secret
export async function createJWTHS(
	payload: Record<string, unknown>,
	secret: string,
	alg: 'HS256' | 'HS384' | 'HS512' = 'HS256'
): Promise<string> {
	const secretKey = new TextEncoder().encode(secret);
	return await new jose.SignJWT(payload)
		.setProtectedHeader({ alg, typ: 'JWT' })
		.setIssuedAt()
		.sign(secretKey);
}

// === AES Operations ===

// Generate AES key
export async function generateAESKey(keySize: AESKeySize = 256): Promise<CryptoKey> {
	return await crypto.subtle.generateKey({ name: 'AES-GCM', length: keySize }, true, ['encrypt', 'decrypt']);
}

// Export AES key to base64
export async function exportAESKey(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// Import AES key from base64
export async function importAESKey(base64Key: string, mode: AESMode = 'AES-GCM'): Promise<CryptoKey> {
	const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
	return await crypto.subtle.importKey('raw', raw, { name: mode }, false, ['encrypt', 'decrypt']);
}

// AES encrypt
export async function encryptAES(plaintext: string, key: CryptoKey, mode: AESMode = 'AES-GCM'): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(mode === 'AES-GCM' ? 12 : 16));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: mode, iv }, key, encoded);
	// Prepend IV to ciphertext
	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.length);
	// rule: chunk the conversion — V8's spread call argument limit is ~65K, so
	// `String.fromCharCode(...combined)` throws RangeError on large ciphertext.
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < combined.length; i += CHUNK) {
		binary += String.fromCharCode(...combined.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// AES decrypt
export async function decryptAES(ciphertext: string, key: CryptoKey, mode: AESMode = 'AES-GCM'): Promise<string> {
	const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
	const ivLength = mode === 'AES-GCM' ? 12 : 16;
	const iv = combined.slice(0, ivLength);
	const data = combined.slice(ivLength);
	const decrypted = await crypto.subtle.decrypt({ name: mode, iv }, key, data);
	return new TextDecoder().decode(decrypted);
}

// === RSA Operations ===

// Generate RSA key pair
export async function generateRSAKeyPair(): Promise<RSAKeyPair> {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['encrypt', 'decrypt']
	);
	const [publicKey, privateKey] = await Promise.all([
		crypto.subtle.exportKey('spki', keyPair.publicKey),
		crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
	]);
	return {
		publicKey: `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(publicKey)))}\n-----END PUBLIC KEY-----`,
		privateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(privateKey)))}\n-----END PRIVATE KEY-----`,
	};
}
