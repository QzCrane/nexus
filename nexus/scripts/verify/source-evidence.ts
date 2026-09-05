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
