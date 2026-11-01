import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler-api';
import { classifyMediaWriters } from './check-spectra-control';
import { hasCanonicalPortSenderAdmission } from './check-sender-verification';

function programFor(sources: Record<string, string>): ts.Program {
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true,
	};
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile;
	const fileExists = host.fileExists;
	const directoryExists = host.directoryExists;
	host.fileExists = (file) => Object.hasOwn(sources, file) || fileExists(file);
	host.directoryExists = (directory) => Object.keys(sources).some((file) => file.startsWith(`${directory}/`))
		|| directoryExists?.(directory) === true;
	host.getSourceFile = (file, version, onError, fresh) => Object.hasOwn(sources, file)
		? ts.createSourceFile(file, sources[file] ?? '', version, true)
		: getSourceFile(file, version, onError, fresh);
	return ts.createProgram(Object.keys(sources), options, host);
}

const virtualRoot = path.resolve(import.meta.dir, '__virtual__').replaceAll('\\', '/');
const writerFile = `${virtualRoot}/writers.ts`;
const portFile = `${virtualRoot}/port.ts`;
const guardFile = `${virtualRoot}/popup-document-sender.ts`;
const guardSource = fs.readFileSync(path.resolve(import.meta.dir,
	'../../apps/extension-spectra/src/background/popup-document-sender.ts'), 'utf8');

function writers(content: string) {
	const program = programFor({ [writerFile]: content });
	const source = program.getSourceFile(writerFile);
	if (!source) throw new Error('Writer fixture is not a compiler input');
	return classifyMediaWriters(source, program.getTypeChecker());
}

describe('compiler-owned media writer classification', () => {
	test('comments and strings cannot create a media writer', () => {
		expect(writers('// video.playbackRate = 1.5;\nconst text = "video.playbackRate = 2";').playbackRate).toBe(false);
	});
	test('real dot, bracket and compound assignments remain writers', () => {
		for (const expression of ['video.playbackRate = 1.3', 'video["playbackRate"] = 1.3', 'video.playbackRate *= 2']) {
			expect(writers(`declare const video: HTMLVideoElement; ${expression};`).playbackRate).toBe(true);
		}
	});
	test('a scrollbar div has no page-media style authority', () => {
		expect(writers('declare const thumb: HTMLDivElement; thumb.style.transform = "translateY(1px)";').inlineVideoStyle).toBe(false);
	});
	test('media, broad element and unresolved receivers stay fail closed', () => {
		for (const type of ['HTMLVideoElement', 'HTMLAudioElement', 'HTMLElement', 'HTMLDivElement | HTMLVideoElement', 'any']) {
			expect(writers(`declare const receiver: ${type}; receiver.style.transform = "rotate(90deg)";`).inlineVideoStyle).toBe(true);
		}
	});
	test('imported receiver aliases retain their DOM identity', () => {
		const program = programFor({
			[`${virtualRoot}/receiver.ts`]: 'export type Receiver = HTMLVideoElement;',
			[writerFile]: 'import type { Receiver as Alias } from "./receiver"; declare const receiver: Alias; receiver.style.filter = "none";',
		});
		const source = program.getSourceFile(writerFile);
		if (!source) throw new Error('Alias fixture is not a compiler input');
		expect(classifyMediaWriters(source, program.getTypeChecker()).inlineVideoStyle).toBe(true);
	});
});

function admitted(body: string, imported = 'isActionPopupSender as guard', alternate?: string, ownerSource = guardSource): boolean {
	const program = programFor({
		[guardFile]: ownerSource,
		[path.resolve(virtualRoot, '../shared/popup-bootstrap.ts').replaceAll('\\', '/')]: 'export const ACTION_POPUP_PATH = "popup.html";',
		[`${virtualRoot}/fake.ts`]: 'export function isActionPopupSender(value: unknown) { return !!value; }',
		[portFile]: `import { ${imported} } from "${alternate ?? './popup-document-sender'}";
			export function bind(port: any, other: any) { ${body} }`,
	});
	const source = program.getSourceFile(portFile);
	if (!source) throw new Error('Sender fixture is not a compiler input');
	return hasCanonicalPortSenderAdmission(source, program.getTypeChecker(), guardFile);
}

const listener = 'port.onMessage.addListener(() => {});';
const guard = 'if (!guard(port.sender)) { port.disconnect(); return; }';

describe('canonical port sender admission', () => {
	test('accepts both canonical guards and import aliases before registration', () => {
		expect(admitted(`${guard} ${listener}`)).toBe(true);
		expect(admitted(`${guard} ${listener}`, 'isPopupDocumentSender as guard')).toBe(true);
	});
	test('rejects missing, late or conditionally executed guards', () => {
		expect(admitted(listener)).toBe(false);
		expect(admitted(`${listener} ${guard}`)).toBe(false);
		expect(admitted(`if (Math.random()) { ${guard} } ${listener}`)).toBe(false);
	});
	test('rejects a same-named guard imported from another owner', () => {
		expect(admitted(`${guard} ${listener}`, 'isActionPopupSender as guard', './fake')).toBe(false);
	});
	test('rejects a local guard even when its name matches', () => {
		expect(admitted(`const guard = () => true; ${guard} ${listener}`)).toBe(false);
	});
	test('requires disconnection and terminal rejection of this exact port', () => {
		expect(admitted(`if (!guard(port.sender)) { port.disconnect(); } ${listener}`)).toBe(false);
		expect(admitted(`if (!guard(other.sender)) { port.disconnect(); return; } ${listener}`)).toBe(false);
		expect(admitted(`if (!guard(port.sender)) { other.disconnect(); return; } ${listener}`)).toBe(false);
	});
	test('rejects a reassigned port after its admission', () => {
		expect(admitted(`${guard} port = other; ${listener}`)).toBe(false);
	});
	test('rejects a canonical forwarder changed to return true', () => {
		expect(admitted(`${guard} ${listener}`, 'isActionPopupSender as guard', undefined,
			guardSource.replace('return sender?.tab === undefined && isPopupDocumentSender(sender);', 'return true;'))).toBe(false);
	});
	test('rejects a base guard that returns true despite strict-check decoys', () => {
		expect(admitted(`${guard} ${listener}`, 'isActionPopupSender as guard', undefined,
			guardSource.replace('if (!sender) return false;', 'return true; // sender.id !== extensionId'))).toBe(false);
		expect(admitted(`${guard} ${listener}`, 'isActionPopupSender as guard', undefined,
			guardSource.replace('sender.id !== extensionId', 'true /* sender.id !== extensionId */'))).toBe(false);
	});
	test('rejects a same-named path constant outside the canonical owner', () => {
		expect(admitted(`${guard} ${listener}`, 'isActionPopupSender as guard', undefined,
			guardSource.replace("import { ACTION_POPUP_PATH } from '../shared/popup-bootstrap';", 'const ACTION_POPUP_PATH = "options.html";'))).toBe(false);
	});
	test('one protected listener cannot hide an unguarded second binder', () => {
		expect(admitted(`${guard} ${listener} }
			export function unsafe(port: any) { ${listener}`)).toBe(false);
	});
});
