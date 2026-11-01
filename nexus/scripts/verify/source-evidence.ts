import path from 'node:path';
import ts from 'typescript-compiler-api';

export interface SourceEvidenceRequirement {
	owner: string;
	fragment: string;
}

// goal: keep static architecture evidence attached to its canonical source owner
// instead of assuming every invariant remains in one historical aggregate file.
export function missingSourceEvidence(
	sources: Readonly<Record<string, string>>,
	requirements: readonly SourceEvidenceRequirement[],
): SourceEvidenceRequirement[] {
	return requirements.filter(({ owner, fragment }) => !sources[owner]?.includes(fragment));
}

// Resolve symbols and receiver types from the application's real compiler
// inputs. Source-text fragments cannot establish cross-module guard ownership.
export function loadSpectraVerificationProgram(root: string): ts.Program {
	const directory = path.resolve(root, 'apps/extension-spectra');
	const configPath = path.join(directory, 'tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
	if (parsed.errors.length > 0) {
		throw new Error(parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
	}
	return ts.createProgram(parsed.fileNames, parsed.options);
}
