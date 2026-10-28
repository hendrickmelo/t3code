/**
 * Whether a rule pattern covers a repository key. `*` stands for one path segment and a trailing
 * `*` for the rest of the path, which must be at least one segment.
 */
function patternMatches(pattern: ReadonlyArray<string>, key: ReadonlyArray<string>): boolean {
  for (const [index, segment] of pattern.entries()) {
    if (segment === "*") {
      if (index === pattern.length - 1) return key.length > index;
      if (key[index] === undefined) return false;
      continue;
    }
    if (key[index] !== segment) return false;
  }
  return pattern.length === key.length;
}

/**
 * The account rule covering a repository, or undefined. `repositoryKey` is the project's
 * `repositoryIdentity.canonicalKey`, `host/owner/repo`. The most specific pattern wins, by count
 * of literal segments, then by pattern order, so the settings file's key order never decides.
 * Shared so a client can show which rule a repository falls under without asking the server.
 */
export function matchSourceControlAccountRule(
  rules: Readonly<Record<string, string>>,
  repositoryKey: string,
): { readonly pattern: string; readonly login: string } | undefined {
  const key = repositoryKey.trim().toLowerCase().split("/");
  let best: { pattern: string; login: string; literals: number } | undefined;
  for (const [pattern, login] of Object.entries(rules)) {
    const segments = pattern.trim().toLowerCase().split("/");
    if (!patternMatches(segments, key)) continue;
    const literals = segments.filter((segment) => segment !== "*").length;
    if (
      best === undefined ||
      literals > best.literals ||
      (literals === best.literals && pattern < best.pattern)
    ) {
      best = { pattern, login, literals };
    }
  }
  return best === undefined ? undefined : { pattern: best.pattern, login: best.login };
}

/** The host a repository key or rule pattern names, its first segment. */
export function sourceControlAccountRuleHost(patternOrKey: string): string {
  return patternOrKey.trim().toLowerCase().split("/")[0] ?? "";
}
