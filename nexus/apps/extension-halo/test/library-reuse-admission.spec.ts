import { describe, expect, test } from 'bun:test';
import { csvToJson } from '../src/tools/csv-to-json/core';
import { parseYaml, jsonToYaml } from '../src/tools/yaml/core';
import { formatJSON, minifyJSON, validateJSON } from '../src/tools/json-formatter/core';
import { formatSql, minifySql, validateSql } from '../src/tools/sql-formatter/core';
import { minifyCode } from '../src/tools/code-formatter/core';
import { decodeHtml, encodeHtmlAll, encodeHtmlNamed } from '../src/tools/html-entity/core';
import { parseCertificate, parseCertificateStrict } from '../src/tools/ssl-cert/core';
import { parseCron, getNextRuns } from '../src/tools/cron/core';

describe('PapaParse admission (R01)', () => {
	test('multi-line quoted fields survive as one record', () => {
		const rows = csvToJson('name,note\nalice,"line one\nline two"\nbob,plain');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.note).toBe('line one\nline two');
		expect(rows[1]?.note).toBe('plain');
	});

	test('cells keep their text: 007, big integers and booleans stay strings', () => {
		const rows = csvToJson('a,b,c\n007,9007199254740993,true');
		expect(rows[0]?.a).toBe('007');
		expect(rows[0]?.b).toBe('9007199254740993');
		expect(rows[0]?.c).toBe('true');
	});

	test('explicit numeric coercion only converts exact numbers', () => {
		const rows = csvToJson('a,b\n12,007', { delimiter: ',', hasHeader: true, coerceNumbers: true });
		expect(rows[0]?.a).toBe(12);
		expect(rows[0]?.b).toBe('007');
	});

	test('quoted delimiter and escaped quotes parse to the intended cells', () => {
		const rows = csvToJson('text\n"a,comma"\n"say ""hi"""');
		expect(rows[0]?.text).toBe('a,comma');
		expect(rows[1]?.text).toBe('say "hi"');
	});
});

describe('yaml engine admission (R02)', () => {
	test('quoted strings keep their text; unquoted true is a real boolean', () => {
		const result = parseYaml('a: "true"\nb: "001"\nc: true');
		expect(result.success).toBe(true);
		const parsed = JSON.parse(result.output) as Record<string, unknown>;
		expect(parsed.a).toBe('true');
		expect(parsed.b).toBe('001');
		expect(parsed.c).toBe(true);
	});

	test('duplicate keys are an explicit error, not a last-wins merge', () => {
		const result = parseYaml('a: 1\na: 2');
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});

	test('integers beyond the safe range survive exactly', () => {
		const result = parseYaml('big: 9007199254740993');
		expect(result.success).toBe(true);
		expect(result.output).toContain('9007199254740993');
	});

	test('JSON to YAML quotes scalars YAML would reinterpret', () => {
		const result = jsonToYaml(JSON.stringify({ flag: 'true', padded: '001', text: 'plain' }));
		expect(result.success).toBe(true);
		const roundTrip = parseYaml(result.output);
		expect(roundTrip.success).toBe(true);
		const parsed = JSON.parse(roundTrip.output) as Record<string, string>;
		expect(parsed.flag).toBe('true');
		expect(parsed.padded).toBe('001');
		expect(parsed.text).toBe('plain');
	});
});

describe('jsonc-parser and lossless-json admission (R03/R04)', () => {
	test('formatting keeps huge integers exact and __proto__ own keys', () => {
		const input = '{"big":9007199254740993,"__proto__":{"injected":true},"plain":1}';
		const result = formatJSON(input, { indent: 2, sortKeys: true });
		expect(result.success).toBe(true);
		// Exact digits survive in the output text.
		expect(result.output).toContain('9007199254740993');
		// The __proto__ own key is data, serialized like any other key.
		expect(result.output).toContain('"__proto__"');
	});

	test('minifying preserves the exact digits of every number', () => {
		const result = minifyJSON('{ "a": 9007199254740993, "b": 0.100, "c": 1e2 }');
		expect(result.success).toBe(true);
		expect(result.output).toContain('9007199254740993');
	});

	test('validation rejects comments and trailing commas with offsets', () => {
		expect(validateJSON('{ "a": 1, }').valid).toBe(false);
		expect(validateJSON('{ /* c */ "a": 1 }').valid).toBe(false);
		expect(validateJSON('{ "a": 1 }').valid).toBe(true);
	});
});

describe('sql-formatter engine admission (R06)', () => {
	test('string literals keep their case and content', () => {
		const formatted = formatSql("select 'MixedCaseValue' from tbl where x = 1");
		expect(formatted).toContain("'MixedCaseValue'");
		// keywordCase preserve keeps the input's own casing.
		expect(formatted.toLowerCase()).toContain('select');
	});

	test('minify collapses whitespace outside literals only', () => {
		const minified = minifySql("select 'a   b'  from   t");
		expect(minified).toContain("'a   b'");
		expect(minified).toContain('from t');
	});

	test('lexical validation reports unterminated strings and unbalanced parens', () => {
		expect(validateSql("select 'oops").valid).toBe(false);
		expect(validateSql('select ((1)').valid).toBe(false);
		expect(validateSql('select 1').valid).toBe(true);
	});
});

describe('CSSO admission (R09)', () => {
	test('string contents keep their spacing while css collapses', async () => {
		const minified = await minifyCode('a {\n  content: "keep  spacing";\n  color: red;\n}', 'css');
		expect(minified).toContain('"keep  spacing"');
		expect(minified).toContain('color:red');
	});
});

describe('entities engine admission (R14)', () => {
	test('non-BMP numeric entities decode to a single code point', () => {
		const decoded = decodeHtml('&#128128; skullemoji');
		expect([...decoded][0]).toBe('💀');
		expect(decoded).toContain('skullemoji');
	});

	test('numeric encoding round-trips astral characters', () => {
		const encoded = encodeHtmlAll('💀');
		// The engine emits hex numeric references for astral code points.
		expect(encoded).toBe('&#x1f480;');
		expect(decodeHtml(encoded)).toBe('💀');
	});

	test('named encoding decodes back to the exact text', () => {
		const encoded = encodeHtmlNamed('© <');
		expect(encoded).toContain('&copy;');
		expect(encoded).toContain('&lt;');
		expect(decodeHtml(encoded)).toBe('© <');
	});
});

describe('@peculiar/x509 admission (R15)', () => {
	test('non-certificate input returns null and strict parse explains why', () => {
		const bogus = `-----BEGIN CERTIFICATE-----\n${Buffer.from('definitely not der').toString('base64')}\n-----END CERTIFICATE-----`;
		expect(parseCertificate(bogus)).toBeNull();
		expect(() => parseCertificateStrict(bogus)).toThrow();
	});

	test('a real self-signed certificate decodes its fields', async () => {
		// The production certificate owner must initialize its metadata prerequisite
		// before this fixture acquires the same CommonJS engine independently.
		const { X509CertificateGenerator, X509Certificate } = await import('@peculiar/x509');
		const algorithm = { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048, saltLength: 32 } as RsaHashedKeyGenParams;
		const certificate = await X509CertificateGenerator.createSelfSigned({
			serialNumber: '1234',
			name: 'CN=Halo Test, O=Nexus',
			notBefore: new Date('2026-01-01T00:00:00Z'),
			notAfter: new Date('2027-01-01T00:00:00Z'),
			algorithm,
			keys: await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']) as CryptoKeyPair,
			extensions: [],
		});
		const pem = `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
		const info = parseCertificate(pem);
		expect(info).not.toBeNull();
		expect(info?.subject.CN).toBe('Halo Test');
		expect(info?.subject.O).toBe('Nexus');
		expect(info?.serialNumber.toLowerCase()).toContain('34');
		expect(info?.validFrom).toContain('2026-01-01');
		expect(info?.validTo).toContain('2027-01-01');
		// The engine also exposes the parsed structure directly.
		expect(new X509Certificate(pem).serialNumber.length).toBeGreaterThan(0);
	});
});

describe('cron-parser admission (R29)', () => {
	test('out-of-range fields are rejected by the engine', () => {
		expect(parseCron('61 * * * *')).toBeNull();
		expect(parseCron('* 25 * * *')).toBeNull();
		expect(parseCron('0 0 * *')).toBeNull();
	});

	test('monthly schedules deliver month-apart results', () => {
		const runs = getNextRuns('0 0 1 * *', 3);
		expect(runs).toHaveLength(3);
		expect(runs[0]?.getUTCDate()).toBe(1);
		const months = runs.map((date) => date.getUTCMonth());
		expect(new Set(months).size).toBeGreaterThan(1);
	});
});
