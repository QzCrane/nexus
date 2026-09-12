export const zh = {
	'tools.ssl-cert.name': 'X.509 证书检查',
	'tools.ssl-cert.desc': '检查单个 PEM X.509 证书的字段',
	sslCert: {
		input: 'PEM 证书',
		validFrom: '有效期始',
		validTo: '有效期至',
		placeholder: '-----BEGIN CERTIFICATE-----...',
		boundary: '只解析单个 PEM X.509 证书；不验证信任、主机名、签名链、吊销状态或实时 TLS 连接。',
		note: '显示的有效期来自证书字段，不代表该证书当前受信任。'
	}
};
