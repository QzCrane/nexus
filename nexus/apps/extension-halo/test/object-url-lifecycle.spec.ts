import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createObjectUrlLease, ObjectUrlSlot } from '../src/kernel/utils/object-url-lease';

let created: string[];
let revoked: string[];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
	created = [];
	revoked = [];
	originalCreate = URL.createObjectURL;
	originalRevoke = URL.revokeObjectURL;
	URL.createObjectURL = (() => {
		const url = `blob:halo-test/${created.length + 1}`;
		created.push(url);
		return url;
	}) as typeof URL.createObjectURL;
	URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
});

afterEach(() => {
	URL.createObjectURL = originalCreate;
	URL.revokeObjectURL = originalRevoke;
});

describe('object URL leases', () => {
	test('release is idempotent and preview replacement retires the old URL', () => {
		const lease = createObjectUrlLease(new Blob(['one']));
		lease.release();
		lease.release();
		const slot = new ObjectUrlSlot();
		expect(slot.replace(new Blob(['two']))).toBe('blob:halo-test/2');
		expect(slot.replace(new Blob(['three']))).toBe('blob:halo-test/3');
		slot.clear();
		expect(revoked).toEqual(created);
	});
});
