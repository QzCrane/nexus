export const en = {
	'tools.ssl-cert.name': 'X.509 Certificate Inspector',
	'tools.ssl-cert.desc': 'Inspect fields in one PEM X.509 certificate',
	sslCert: {
		input: 'PEM Certificate',
		validFrom: 'Valid From',
		validTo: 'Valid To',
		placeholder: '-----BEGIN CERTIFICATE-----...',
		boundary: 'Parses one PEM X.509 certificate. It does not verify trust, hostname, signature chain, revocation, or a live TLS connection.',
		note: 'Displayed validity dates are certificate fields, not proof that the certificate is currently trusted.'
	}
};
