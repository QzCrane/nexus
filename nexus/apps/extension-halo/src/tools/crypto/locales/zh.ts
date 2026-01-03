export const zh = {
	'tools.crypto.name': '加密工具',
	'tools.crypto.desc': 'JWT, RSA, AES 加密解密',
	crypto: {
		jwt: {
			decode: '解码',
			create: '创建',
			verify: '验证',
			token: '令牌',
			secret: '密钥',
			secretPlaceholder: '输入密钥...',
			payload: '载荷',
			generate: '生成 JWT',
			valid: '签名有效',
			invalid: '签名无效',
			placeholderToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
			placeholderPayload: '{"key": "value"}'
		},
		aes: {
			key: 'AES 密钥 (Base64)',
			generateKey: '生成密钥',
			keyPlaceholder: '输入或生成 AES 密钥...',
			plaintext: '明文',
			ciphertext: '密文',
			encrypt: '加密',
			decrypt: '解密',
			encryptFailed: '加密失败',
			decryptFailed: '解密失败'
		},
		rsa: {
			generate: '生成 RSA 密钥对',
			publicKey: '公钥',
			privateKey: '私钥'
		},
		modes: {
			jwt: 'JWT',
			aes: 'AES',
			rsa: 'RSA'
		}
	}
};
