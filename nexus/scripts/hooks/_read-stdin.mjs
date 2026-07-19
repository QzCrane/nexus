#!/usr/bin/env bun
// _read-stdin.mjs
//
// Shared helper used by all AI-tool hook scripts. Reads the
// `stdin` payload that the host AI (Claude Code, Codex, Gemini
// CLI, etc.) feeds to the hook. Drained in one shot, no encoding
// surprises.

export function readStdin() {
	return new Promise((resolve) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => (data += c));
		process.stdin.on('end', () => resolve(data));
	});
}
