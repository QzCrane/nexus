// Core exports for rule system
// Re-exports types, compiler, and engine from separate modules

export type {
	ResolveContext,
	RuleResult,
	Resolver,
	RuleConfig,
	SiteRule
} from './types';

export { compileRule } from './compiler';
export { RuleEngine } from './rule-engine';
