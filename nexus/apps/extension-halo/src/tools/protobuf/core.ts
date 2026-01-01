// goal: Protobuf Heuristic Decoder
// Decodes a raw protobuf binary (wire format) without a proto file.
// Displays fields, wire types, and values.

export interface ProtoField {
	fieldNumber: number;
	wireType: number;
	value: unknown;
	subMessage?: ProtoField[];
	raw?: Uint8Array;
}

// Wire Types
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_64BIT = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_START_GROUP = 3;
const WIRE_TYPE_END_GROUP = 4;
const WIRE_TYPE_32BIT = 5;

// Basic Reader
class BufferReader {
	private offset = 0;
	constructor(private buffer: Uint8Array) { }

	readVarint(): number {
		let result = 0;
		let shift = 0;
		while (true) {
			if (this.offset >= this.buffer.length) throw new Error("Index out of bounds");
			const byte = this.buffer[this.offset++];
			result |= (byte & 0x7f) << shift;
			shift += 7;
			if ((byte & 0x80) === 0) break;
			if (shift > 35) throw new Error("Varint too large"); // JS bitwise limit
		}
		return result >>> 0; // Unsigned
	}

	readBytes(length: number): Uint8Array {
		if (this.offset + length > this.buffer.length) throw new Error("Index out of bounds");
		const bytes = this.buffer.slice(this.offset, this.offset + length);
		this.offset += length;
		return bytes;
	}

	readFixed32(): number {
		// Little endian
		const bytes = this.readBytes(4);
		return new DataView(bytes.buffer).getUint32(0, true);
	}

	readFixed64(): bigint {
		const bytes = this.readBytes(8);
		return new DataView(bytes.buffer).getBigUint64(0, true);
	}

	eof(): boolean {
		return this.offset >= this.buffer.length;
	}
}

export function decodeProto(buffer: Uint8Array): ProtoField[] {
	const reader = new BufferReader(buffer);
	const fields: ProtoField[] = [];

	while (!reader.eof()) {
		try {
			const tag = reader.readVarint();
			const fieldNumber = tag >>> 3;
			const wireType = tag & 0x07;

			let value: any;
			let subMessage: ProtoField[] | undefined;

			switch (wireType) {
				case WIRE_TYPE_VARINT:
					value = reader.readVarint();
					break;
				case WIRE_TYPE_64BIT:
					value = reader.readFixed64().toString();
					break;
				case WIRE_TYPE_LENGTH_DELIMITED:
					const length = reader.readVarint();
					const bytes = reader.readBytes(length);
					value = bytes; // Raw bytes
					// Heuristic: Try to decode as string
					if (isPrintableString(bytes)) {
						value = new TextDecoder().decode(bytes);
					} else {
						// Heuristic: Try to recursively decode as sub-message
						try {
							subMessage = decodeProto(bytes);
							// Simple check: if valid sub-message, use it? 
							// Only if it doesn't look like garbage. 
							if (subMessage.length > 0) value = "(Sub-message)";
						} catch {
							// Ignore, keep as bytes
						}
					}
					if (subMessage && subMessage.length === 0) subMessage = undefined;
					break;
				case WIRE_TYPE_32BIT:
					value = reader.readFixed32();
					break;
				case WIRE_TYPE_START_GROUP:
				case WIRE_TYPE_END_GROUP:
					value = "Group (Deprecated)";
					break;
				default:
					value = "Unknown WireType " + wireType;
					// Likely garbage or parsing error, stop
					return fields;
			}

			fields.push({ fieldNumber, wireType, value, subMessage });

		} catch (e) {
			break; // Stop parsing on error
		}
	}

	return fields;
}

function isPrintableString(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return true;
	for (const b of bytes) {
		if (b < 32 && b !== 9 && b !== 10 && b !== 13) return false; // Common ASCII control chars
	}
	return true;
}

// Helper to convert input to Uint8Array
export function parseInput(input: string): Uint8Array | null {
	try {
		// Hex
		if (/^[0-9a-fA-F\s]+$/.test(input)) {
			const hex = input.replace(/\s/g, '');
			if (hex.length % 2 === 0) {
				const arr = new Uint8Array(hex.length / 2);
				for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.substr(i, 2), 16);
				return arr;
			}
		}
		// Base64
		const binary = atob(input);
		const arr = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
		return arr;
	} catch {
		return null;
	}
}
