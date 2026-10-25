/**
 * SPECTRA remote-site projection check.
 *
 * The remote page is deployed without a build step, so its wire protocol and
 * vendored transport are committed projections of extension-owned sources.
 * This gate fails when any projection is stale, when the page stops loading the
 * protocol before its own app shell, or when the page grows a second copy of the
 * wire surface.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	buildRemoteProtocolProjection,
	readCommittedRemoteProtocolProjection,
	readCommittedRemoteProjection,
	REMOTE_VENDOR_PROJECTION_FILES,
} from '../../apps/extension-spectra/scripts/generate-remote-projection.ts';
import { error, ok, section } from './utils.ts';

const PROTOCOL_SCRIPT = /<script\b[^>]*\bsrc=["']dist\/protocol\.js["'][^>]*>/u;
const APP_SCRIPT = /<script\b[^>]*\bsrc=["']app\.js["'][^>]*>/u;
const REGENERATION = 'run "bun run generate:remote-projection" in nexus/';

/** Wire ownership markers that must exist only in the generated projection. */
const DUPLICATED_WIRE_SURFACE = Object.freeze([
	'spectra-remote-v',
	'crypto.subtle',
	'PROTOCOL_VERSION =',
	'const TOKEN_RE',
	'const NONCE_RE',
	'hasOnlyKeys(',
	'decodeBase64Url',
	'createProof(',
]);

export function checkRemoteProjection(ROOT: string): void {
	section('检查 Remote 投影...');

	const remoteDir = path.resolve(ROOT, '../remote-site');
	if (!fs.existsSync(remoteDir)) {
		ok('remote-site 不在当前工作区，跳过投影检查');
		return;
	}

	let failures = 0;

	const committed = readCommittedRemoteProtocolProjection();
	if (!committed) {
		error(`REMOTE-PROTO-001: remote-site/dist/protocol.js is missing; ${REGENERATION}`);
		failures++;
	} else {
		const expected = buildRemoteProtocolProjection();
		if (!committed.equals(expected)) {
			error(`REMOTE-PROTO-001: remote-site/dist/protocol.js is stale; ${REGENERATION}`);
			failures++;
		}
	}

	for (const file of REMOTE_VENDOR_PROJECTION_FILES) {
		const committedVendor = readCommittedRemoteProjection(file.projectionPath);
		if (!committedVendor) {
			error(`REMOTE-VENDOR-001: ${file.label} is missing; ${REGENERATION}`);
			failures++;
		} else if (!committedVendor.equals(fs.readFileSync(file.ownerPath))) {
			error(`REMOTE-VENDOR-001: ${file.label} is stale; ${REGENERATION}`);
			failures++;
		}
	}

	const indexPath = path.join(remoteDir, 'index.html');
	const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
	const protocolScript = PROTOCOL_SCRIPT.exec(indexHtml);
	const appScript = APP_SCRIPT.exec(indexHtml);
	if (!protocolScript || !appScript || (protocolScript.index ?? 0) > (appScript.index ?? 0)) {
		error('REMOTE-PROTO-002: remote-site/index.html must load dist/protocol.js before app.js');
		failures++;
	}

	const appPath = path.join(remoteDir, 'app.js');
	const appSource = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
	if (!appSource.includes('globalThis.SpectraRemoteProtocol')) {
		error('REMOTE-PROTO-003: remote-site/app.js must consume globalThis.SpectraRemoteProtocol instead of owning protocol primitives');
		failures++;
	}
	for (const marker of DUPLICATED_WIRE_SURFACE) {
		if (appSource.includes(marker)) {
			error(`REMOTE-PROTO-003: remote-site/app.js duplicates the extension-owned wire surface (${marker})`);
			failures++;
		}
	}

	if (failures === 0) {
		ok('Remote 页面消费扩展侧唯一协议与 transport 投影');
	}
}
