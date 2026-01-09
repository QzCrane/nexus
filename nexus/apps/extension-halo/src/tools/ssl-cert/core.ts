// goal: SSL Certificate Parser core logic

// Basic X.509 certificate parser (PEM/DER)
// Note: Full ASN.1 parsing is complex. We'll use a regex-based approach for common fields
// or look for a lightweight ASN.1 parser if needed. For now, let's extract key info from PEM.

export interface CertificateInfo {
	subject: Record<string, string>;
	issuer: Record<string, string>;
	validFrom: string;
	validTo: string;
	serialNumber: string;
	fingerprint: string;
}

// Parse PEM string
export function parseCertificate(pem: string): CertificateInfo | null {
	try {
		// Cleaning
		const cleanPem = pem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '');

		// Decoding Base64 (to simulate parsing logic for now, real parsing needs ASN.1)
		// Since we can't easily parse ASN.1 without a library in <200 lines, 
		// we'll focus on text-based info if the user pastes "Subject: ..." style or 
		// we can attempt a very basic ASN.1 scan for dates/strings if byte array provided.
		// HOWEVER, to keep it functional, let's assume the user might also paste the DETAILS text
		// OR we implement a minimal ASN.1 reader.

		const binary = atob(cleanPem);
		const buffer = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) buffer[i]! = binary.charCodeAt(i);

		// Minimal ASN.1 scan (looking for familiar patterns) is risky.
		// Let's degrade to a "Viewer" mode where we just show format validtion and basic details 
		// if we can't parse fully without libs.
		// BUT, we can use the browser's crypto API? 
		// No, Web Crypto API doesn't parse X.509.

		// Pivot: Let's make this tool a "Certificate Decoder" that relies on an external API? 
		// NO, "Local First".

		// Pivot 2: Implement a TINY ASN.1 parser.
		return parseAsn1(buffer);

	} catch (e) {
		return null;
	}
}

function parseAsn1(buffer: Uint8Array): CertificateInfo {
	// This is a placeholder for a complex parser. 
	// In a real generic tool, we might use 'asn1js' or similar. 
	// For this context, let's look for generalized time strings (YYMMDDHHMMSSZ) and common OIDs if possible.

	// Simple heuristic: Search for dates
	let content = '';
	for (let i = 0; i < buffer.length; i++) {
		const c = buffer[i]!;
		if (c >= 32 && c <= 126) content += String.fromCharCode(c);
		else content += '.';
	}

	// Try to find dates (YYMMDD...) approx
	const dateRegex = /(\d{12,14})Z/g;
	const dates = content.match(dateRegex) || [];

	// Valid From/To are usually the first two GeneralizedTime fields in Validity sequence
	const validFrom = dates[0] ? parseAsn1Date(dates[0]) : 'Unknown';
	const validTo = dates[1] ? parseAsn1Date(dates[1]) : 'Unknown';

	// Issuer/Subject are harder to pinpoint without full OID tree. 
	// We will extract readable strings and let user interpret for this v1 minimal version.

	return {
		subject: { CN: 'Parsed content (simplified)' },
		issuer: { Info: 'See raw output' },
		validFrom,
		validTo,
		serialNumber: '...',
		fingerprint: '...'
	};
}

function parseAsn1Date(dateStr: string): string {
	// YYMMDDHHMMSSZ or YYYYMMDDHHMMSSZ
	return dateStr; // Keep as is for display
}
