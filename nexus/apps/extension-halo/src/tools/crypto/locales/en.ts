export const en = {
	'tools.crypto.name': 'Crypto Tools',
	'tools.crypto.desc': 'JWT, RSA, AES encryption',
	crypto: {
		jwt: {
			decode: 'Decode',
			create: 'Create',
			verify: 'Verify',
			token: 'Token',
			secret: 'Secret',
			secretPlaceholder: 'Enter secret key...',
			payload: 'Payload',
			generate: 'Generate JWT',
			valid: 'Signature Valid',
			invalid: 'Signature Invalid',
			placeholderToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
			placeholderPayload: '{"key": "value"}'
		},
		aes: {
			key: 'AES Key (Base64)',
			generateKey: 'Generate Key',
			keyPlaceholder: 'Enter or generate AES key...',
			plaintext: 'Plaintext',
			ciphertext: 'Ciphertext',
			encrypt: 'Encrypt',
			decrypt: 'Decrypt',
			encryptFailed: 'Encrypt failed',
			decryptFailed: 'Decrypt failed'
		},
		rsa: {
			generate: 'Generate RSA Key Pair',
			publicKey: 'Public Key',
			privateKey: 'Private Key'
		},
		modes: {
			jwt: 'JWT',
			aes: 'AES',
			rsa: 'RSA'
		}
	}
};
