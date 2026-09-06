// goal: bounded, schema-free Protocol Buffers wire decoding without integer loss
export type ProtoValue = number | string | Uint8Array;
export interface ProtoField {
	offset: number; fieldNumber: number; wireType: number; value: ProtoValue;
	subMessage?: ProtoField[]; raw?: Uint8Array;
	interpretation?: 'utf8-candidate' | 'message-candidate' | 'group' | 'bytes';
}

// Explicit interactive resource envelope, not a claim about all machine sizes.
export const PROTO_LIMITS = { bytes: 262_144, fields: 4096, depth: 32 } as const;

class Reader {
	position = 0;
	constructor(readonly buffer: Uint8Array) {}
	varint(): bigint {
		let value = 0n;
		for (let index = 0; index < 10; index += 1) {
			const byte = this.buffer[this.position++];
			if (byte === undefined) throw new Error('Truncated varint');
			if (index === 9 && byte > 1) throw new Error('Varint exceeds 64 bits');
			value |= BigInt(byte & 127) << BigInt(index * 7);
			if (byte < 128) return value;
		}
		throw new Error('Unterminated varint');
	}
	bytes(length: number): Uint8Array {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.buffer.length - this.position) {
			throw new Error('Truncated or oversized length-delimited field');
		}
		const data = this.buffer.subarray(this.position, this.position + length);
		this.position += length;
		return data;
	}
}

function exactNumber(value: bigint): number | string {
	return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function fields(reader: Reader, budget: { remaining: number }, depth = 0, group?: number): ProtoField[] {
	if (depth > PROTO_LIMITS.depth) throw new Error('Protobuf nesting limit exceeded');
	const result: ProtoField[] = [];
	while (reader.position < reader.buffer.length) {
		const offset = reader.position;
		const tag = reader.varint();
		const fieldNumber = Number(tag >> 3n);
		const wireType = Number(tag & 7n);
		if (fieldNumber < 1 || fieldNumber > 0x1fffffff) throw new Error('Invalid Protobuf field number');
		if (wireType === 4) {
			if (group !== fieldNumber) throw new Error('Mismatched Protobuf end-group');
			return result;
		}
		if (--budget.remaining < 0) throw new Error('Protobuf field count limit exceeded');
		const field: ProtoField = { offset, fieldNumber, wireType, value: '' };
		switch (wireType) {
			case 0: field.value = exactNumber(reader.varint()); break;
			case 1: {
				const bytes = reader.bytes(8);
				field.raw = bytes;
				field.value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true).toString();
				break;
			}
			case 2: {
				const length = reader.varint();
				if (length > BigInt(reader.buffer.length - reader.position)) throw new Error('Truncated length-delimited field');
				const bytes = reader.bytes(Number(length));
				field.raw = bytes;
				field.value = bytes;
				field.interpretation = 'bytes';
				try {
					const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
					if ([...text].every((char) => char.charCodeAt(0) >= 32 || '\t\n\r'.includes(char))) {
						field.value = text;
						field.interpretation = 'utf8-candidate';
					}
				} catch { field.interpretation = 'bytes'; }
				if (field.interpretation === 'bytes' && bytes.length > 0 && depth < PROTO_LIMITS.depth) {
					try {
						const nested = fields(new Reader(bytes), budget, depth + 1);
						if (nested.length) { field.subMessage = nested; field.interpretation = 'message-candidate'; }
					} catch { field.interpretation = 'bytes'; }
				}
				if (budget.remaining < 0) throw new Error('Protobuf interpretation work limit exceeded');
				break;
			}
			case 3:
				field.subMessage = fields(reader, budget, depth + 1, fieldNumber);
				field.interpretation = 'group';
				break;
			case 5: {
				const bytes = reader.bytes(4);
				field.raw = bytes;
				field.value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
				break;
			}
			default: throw new Error(`Invalid Protobuf wire type ${wireType}`);
		}
		result.push(field);
	}
	if (group !== undefined) throw new Error('Unterminated Protobuf group');
	return result;
}

export function decodeProto(buffer: Uint8Array): ProtoField[] {
	if (buffer.byteLength > PROTO_LIMITS.bytes) throw new Error('Interactive Protobuf input exceeds 256 KiB');
	return fields(new Reader(buffer), { remaining: PROTO_LIMITS.fields });
}

export function parseInput(input: string, format: 'auto' | 'hex' | 'base64' = 'auto'): Uint8Array | null {
	try {
		const text = input.replace(/\s/gu, '');
		if (text.length > PROTO_LIMITS.bytes * 2) return null;
		if (format === 'hex' || (format === 'auto' && /^[a-f0-9]*$/iu.test(text))) {
			if (text.length % 2 || !/^[a-f0-9]*$/iu.test(text)) return null;
			return Uint8Array.from(text.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
		}
		if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(text) || text.length % 4 === 1) return null;
		const binary = atob(text);
		if (binary.length > PROTO_LIMITS.bytes || btoa(binary).replace(/=+$/u, '') !== text.replace(/=+$/u, '')) return null;
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch { return null; }
}
