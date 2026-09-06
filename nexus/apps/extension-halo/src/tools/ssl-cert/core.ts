// goal: SSL Certificate adapter over @peculiar/x509 (R15)
// rule: DER/PEM decoding, OID handling and date parsing belong to the
// maintained engine. This adapter owns the display contract and the failure
// semantics: input that is not a decodable X.509 certificate returns null and
// is reported — no field is ever fabricated, and parsing success is never
// presented as trust, signature validation or revocation checking.

// reflect-metadata is the tsyringe peer polyfill the x509 engine requires.
import 'reflect-metadata';
import { X509Certificate } from '@peculiar/x509';

export interface CertificateInfo {
	subject: Record<string, string>;
	issuer: Record<string, string>;
	validFrom: string;
	validTo: string;
	serialNumber: string;
}

type JsonNameEntry = Record<string, string[] | Record<string, string>[]>;

function nameToMap(name: { toJSON(): JsonNameEntry[] }): Record<string, string> {
	const result: Record<string, string> = {};
	for (const attribute of name.toJSON()) {
		for (const [key, value] of Object.entries(attribute)) {
			if (key === 'oid' || key === 'shortName' || key === 'longName') continue;
			const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
			if (values.length > 0) result[key] = values.join(', ');
		}
	}
	return result;
}

/**
 * Parse a PEM X.509 certificate. Returns null for input that cannot be decoded;
 * for callers that surface the reason, use parseCertificateStrict.
 */
export function parseCertificate(pem: string): CertificateInfo | null {
	try {
		return parseCertificateStrict(pem);
	} catch {
		return null;
	}
}

/** Parse and throw a descriptive error on non-certificate input. */
export function parseCertificateStrict(pem: string): CertificateInfo {
	const cert = new X509Certificate(pem);
	return {
		subject: nameToMap(cert.subjectName),
		issuer: nameToMap(cert.issuerName),
		validFrom: cert.notBefore.toISOString(),
		validTo: cert.notAfter.toISOString(),
		serialNumber: cert.serialNumber,
	};
}
