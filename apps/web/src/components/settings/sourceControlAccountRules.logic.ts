import {
  canonicalRepositoryKey,
  matchSourceControlAccountOverrideEntry,
  sourceControlAccountSupport,
} from "@t3tools/shared/sourceControl";
import type { SourceControlProviderKind } from "@t3tools/contracts";

export interface AccountRule {
  readonly pattern: string;
  readonly login: string;
}

export interface KnownRepository {
  readonly canonicalKey: string;
  /** Every project pointing at this repository, which is what a rule silently covers too. */
  readonly projectTitles: ReadonlyArray<string>;
}

export interface RepositoryAccount extends KnownRepository {
  /** The rule that decided, or null where the active account is used. */
  readonly pattern: string | null;
  readonly login: string | null;
  /** Set where the rule names an account this repository's provider cannot select. */
  readonly unsupportedReason: string | null;
}

export interface AccountRuleSummary extends AccountRule {
  /** Repositories this rule decides, after more specific rules have taken theirs. */
  readonly matches: ReadonlyArray<string>;
}

/**
 * Rules in the order the reader should see them: most specific first, which is also the order
 * they are applied in. Two equally specific rules order by pattern so the list never depends on
 * the settings file's key order.
 */
export function sortAccountRules(overrides: Readonly<Record<string, string>>): AccountRule[] {
  return Object.entries(overrides)
    .map(([pattern, login]) => ({ pattern, login }))
    .toSorted((left, right) => {
      const literals = (rule: AccountRule) =>
        rule.pattern.split("/").filter((segment) => segment !== "*").length;
      return literals(right) - literals(left) || left.pattern.localeCompare(right.pattern);
    });
}

/** The repositories the workspace knows, de-duplicated, since worktrees share one repository. */
export function knownRepositories(
  projects: ReadonlyArray<{
    readonly title: string;
    readonly repositoryIdentity?: { readonly canonicalKey: string } | null | undefined;
  }>,
): KnownRepository[] {
  const byKey = new Map<string, string[]>();
  for (const project of projects) {
    const key = project.repositoryIdentity?.canonicalKey;
    if (key === undefined || key.trim() === "") continue;
    const canonical = canonicalRepositoryKey(key.trim().toLowerCase());
    const held = byKey.get(canonical);
    if (held === undefined) byKey.set(canonical, [project.title]);
    else if (!held.includes(project.title)) held.push(project.title);
  }
  return [...byKey]
    .map(([canonicalKey, projectTitles]) => ({ canonicalKey, projectTitles }))
    .toSorted((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));
}

/**
 * What each repository resolves to and which rule said so, which is the question a reader
 * actually has when a pull request opens as the wrong person.
 */
export function resolveRepositoryAccounts(
  overrides: Readonly<Record<string, string>>,
  repositories: ReadonlyArray<KnownRepository>,
  providerKindForHost: (host: string) => SourceControlProviderKind | undefined,
): RepositoryAccount[] {
  return repositories.map((repository) => {
    const matched = matchSourceControlAccountOverrideEntry(overrides, repository.canonicalKey);
    if (matched === undefined) {
      return { ...repository, pattern: null, login: null, unsupportedReason: null };
    }
    const host = repository.canonicalKey.split("/")[0] ?? "";
    const kind = providerKindForHost(host);
    const support = kind === undefined ? undefined : sourceControlAccountSupport(kind);
    return {
      ...repository,
      pattern: matched.pattern,
      login: matched.login,
      unsupportedReason:
        support === undefined || support.supported === true ? null : support.reason,
    };
  });
}

/**
 * Each rule with the repositories it actually decides. A rule covering repositories a more
 * specific rule takes does not list them, so the counts add up to the repositories pinned.
 */
export function summariseAccountRules(
  overrides: Readonly<Record<string, string>>,
  repositories: ReadonlyArray<KnownRepository>,
): AccountRuleSummary[] {
  const resolved = resolveRepositoryAccounts(overrides, repositories, () => undefined);
  return sortAccountRules(overrides).map((rule) => ({
    ...rule,
    matches: resolved
      .filter((repository) => repository.pattern === rule.pattern)
      .map((repository) => repository.canonicalKey),
  }));
}

export interface AccountRuleEdit {
  readonly pattern: string;
  readonly login: string;
  /** The pattern being replaced, so renaming a rule does not leave the old one behind. */
  readonly originalPattern?: string | undefined;
  readonly remove?: boolean | undefined;
}

/**
 * The rules after one edit. Returns the record to send as the whole new set, since the patch
 * replaces rather than merges.
 */
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
  if (segments[0] === "*") return "Name a host; a rule cannot cover every host at once.";
  if (trimmed !== originalPattern && Object.hasOwn(existing, trimmed)) {
    return "There is already a rule for this pattern.";
  }
  return null;
}
