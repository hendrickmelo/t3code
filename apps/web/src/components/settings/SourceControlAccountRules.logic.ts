import type { SourceControlProviderKind } from "@t3tools/contracts";
import {
  matchSourceControlAccountRule,
  sourceControlClients,
} from "@t3tools/client-runtime/source-control-clients";

export interface AccountRule {
  readonly pattern: string;
  readonly login: string;
}

export interface KnownRepository {
  readonly canonicalKey: string;
  readonly kind: SourceControlProviderKind | null;
  /** Every project of this repository, which one rule covers together. */
  readonly projectTitles: ReadonlyArray<string>;
}

export interface RepositoryAccount extends KnownRepository {
  /** The rule that decided, or null where the host's own account is used. */
  readonly pattern: string | null;
  readonly login: string | null;
  /** Set where the rule names an account this repository's host cannot select. */
  readonly unsupportedHost: string | null;
}

export interface AccountRuleSummary extends AccountRule {
  /** Repositories this rule decides, after more specific rules have taken theirs. */
  readonly matches: ReadonlyArray<string>;
}

const literalSegments = (pattern: string) =>
  pattern.split("/").filter((segment) => segment !== "*").length;

/** Most specific first, the order rules apply in; ties by pattern, never by settings key order. */
export function sortAccountRules(rules: Readonly<Record<string, string>>): AccountRule[] {
  return Object.entries(rules)
    .map(([pattern, login]) => ({ pattern, login }))
    .toSorted(
      (left, right) =>
        literalSegments(right.pattern) - literalSegments(left.pattern) ||
        left.pattern.localeCompare(right.pattern),
    );
}

/** The repositories the environment's projects point at, once each: worktrees share one. */
export function knownRepositories(
  projects: ReadonlyArray<{
    readonly title: string;
    readonly repositoryIdentity?:
      | { readonly canonicalKey: string; readonly provider?: SourceControlProviderKind }
      | null
      | undefined;
  }>,
): KnownRepository[] {
  const byKey = new Map<string, { kind: SourceControlProviderKind | null; titles: string[] }>();
  for (const project of projects) {
    const identity = project.repositoryIdentity;
    const key = identity?.canonicalKey?.trim().toLowerCase();
    if (key === undefined || key === "") continue;
    const held = byKey.get(key);
    if (held === undefined) {
      byKey.set(key, { kind: identity?.provider ?? null, titles: [project.title] });
    } else if (!held.titles.includes(project.title)) held.titles.push(project.title);
  }
  return [...byKey]
    .map(([canonicalKey, { kind, titles }]) => ({ canonicalKey, kind, projectTitles: titles }))
    .toSorted((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));
}

/** What each repository acts as and which rule said so. */
export function resolveRepositoryAccounts(
  rules: Readonly<Record<string, string>>,
  repositories: ReadonlyArray<KnownRepository>,
): RepositoryAccount[] {
  return repositories.map((repository) => {
    const matched = matchSourceControlAccountRule(rules, repository.canonicalKey);
    if (matched === undefined) {
      return { ...repository, pattern: null, login: null, unsupportedHost: null };
    }
    const definition =
      repository.kind === null ? undefined : sourceControlClients.find(repository.kind);
    return {
      ...repository,
      ...matched,
      unsupportedHost:
        definition !== undefined && definition.selectsAccountPerRepository !== true
          ? definition.label
          : null,
    };
  });
}

/** Each rule with the repositories it decides, so the counts add up to the repositories ruled. */
export function summariseAccountRules(
  rules: Readonly<Record<string, string>>,
  resolved: ReadonlyArray<RepositoryAccount>,
): AccountRuleSummary[] {
  return sortAccountRules(rules).map((rule) => ({
    ...rule,
    matches: resolved
      .filter((repository) => repository.pattern === rule.pattern)
      .map((repository) => repository.canonicalKey),
  }));
}

export function repositoryAccountSummary(ruled: number, total: number): string {
  const noun = total === 1 ? "repository" : "repositories";
  if (ruled === 0) return `${total} ${noun}, none covered by a rule.`;
  if (ruled === total) return `${total} ${noun}, all covered by a rule.`;
  return `${ruled} of ${total} ${noun} covered by a rule; the rest use their host's account.`;
}

export interface AccountRuleEdit {
  readonly pattern: string;
  readonly login: string;
  /** The pattern being replaced, so renaming a rule does not leave the old one behind. */
  readonly originalPattern?: string | undefined;
  readonly remove?: boolean | undefined;
}

/** The whole rule set after one edit, which is what the settings patch replaces. */
export function updateAccountRules(
  current: Readonly<Record<string, string>>,
  edit: AccountRuleEdit,
): Record<string, string> {
  const next: Record<string, string> = { ...current };
  if (edit.originalPattern !== undefined) delete next[edit.originalPattern];
  if (edit.remove === true) {
    delete next[edit.pattern];
    return next;
  }
  const pattern = edit.pattern.trim().toLowerCase();
  const login = edit.login.trim();
  if (pattern === "" || login === "") return next;
  next[pattern] = login;
  return next;
}

/** Why a pattern cannot be saved, or null where it can. */
export function accountRulePatternError(
  pattern: string,
  existing: Readonly<Record<string, string>>,
  originalPattern?: string,
): string | null {
  const trimmed = pattern.trim().toLowerCase();
  if (trimmed === "") return "Enter a repository, owner, or host.";
  const segments = trimmed.split("/");
  if (segments.length < 2) return "Use host/owner/repository, with * for any part.";
  if (segments.some((segment) => segment === "")) return "Remove the empty path segment.";
  if (segments[0] === "*") return "Name a host; one rule cannot cover every host.";
  if (trimmed !== originalPattern && Object.hasOwn(existing, trimmed)) {
    return "There is already a rule for this pattern.";
  }
  return null;
}
