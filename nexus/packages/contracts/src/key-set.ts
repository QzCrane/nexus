// goal: bind a runtime key allowlist to the type it validates
//
// Every validator in this package answers two questions: which keys are allowed,
// and what shape each value must have. The second is checked by the compiler,
// because it is written as a type. The first was checked by nothing: the
// allowlist was a hand-written set, so a field added to the type and missed in
// the set turned every valid payload into an "invalid response" at the wire.
// `keySetOf<T>()` moves that check into the type system. The argument has to
// name every key of T; an omission is a compile error that names the missing
// key, so the two representations can no longer drift between builds.

export type CompleteKeys<T, K extends readonly (keyof T & string)[]> =
	Exclude<keyof T, K[number]> extends never
		? K
		: K & { readonly missingKeys: Exclude<keyof T, K[number]> };

export function keySetOf<T>(): <K extends readonly (keyof T & string)[]>(
	keys: CompleteKeys<T, K>,
) => ReadonlySet<string> {
	return <K extends readonly (keyof T & string)[]>(keys: CompleteKeys<T, K>) =>
		new Set<string>(keys as readonly string[]);
}
