import { describe, expect, it } from "vite-plus/test";

import {
  accountRulePatternError,
  knownRepositories,
  repositoryAccountSummary,
  resolveRepositoryAccounts,
  sortAccountRules,
  summariseAccountRules,
  updateAccountRules,
} from "./sourceControlAccountRules.logic";

const project = (title: string, canonicalKey?: string) => ({
  title,
  ...(canonicalKey === undefined ? {} : { repositoryIdentity: { canonicalKey } }),
});

describe("source control account rules", () => {
  const overrides = {
    "github.com/*": "personal",
    "github.com/acme/*": "work",
    "github.com/acme/web": "release-bot",
  };

  it("orders rules most specific first, independent of the settings file", () => {
    expect(sortAccountRules(overrides).map((rule) => rule.pattern)).toEqual([
      "github.com/acme/web",
      "github.com/acme/*",
      "github.com/*",
    ]);
  });

  it("collapses worktrees of one repository and keeps the projects that share it", () => {
    const repositories = knownRepositories([
      project("web", "github.com/acme/web"),
      project("web worktree", "GitHub.com/Acme/Web"),
      project("no remote"),
      project("site", "github.com/maria/site"),
    ]);
    expect(repositories).toEqual([
      { canonicalKey: "github.com/acme/web", projectTitles: ["web", "web worktree"] },
      { canonicalKey: "github.com/maria/site", projectTitles: ["site"] },
    ]);
  });

  it("reports the account each repository resolves to and which rule decided", () => {
    const repositories = knownRepositories([
      project("web", "github.com/acme/web"),
      project("api", "github.com/acme/api"),
      project("site", "github.com/maria/site"),
      project("ops", "gitlab.com/group/ops"),
    ]);
    const resolved = resolveRepositoryAccounts(overrides, repositories, (host) =>
      host === "gitlab.com" ? "gitlab" : "github",
    );
    expect(resolved.map((entry) => [entry.canonicalKey, entry.login, entry.pattern])).toEqual([
      ["github.com/acme/api", "work", "github.com/acme/*"],
      ["github.com/acme/web", "release-bot", "github.com/acme/web"],
      ["github.com/maria/site", "personal", "github.com/*"],
      ["gitlab.com/group/ops", null, null],
    ]);
  });

  it("flags a rule naming an account the provider cannot select", () => {
    const repositories = knownRepositories([project("ops", "gitlab.com/group/ops")]);
    const [resolved] = resolveRepositoryAccounts(
      { "gitlab.com/group/*": "maria" },
      repositories,
      () => "gitlab",
    );
    expect(resolved?.login).toBe("maria");
    expect(resolved?.unsupportedReason).toContain("store credentials");
  });

  it("counts each repository against the one rule that decides it", () => {
    const repositories = knownRepositories([
      project("web", "github.com/acme/web"),
      project("api", "github.com/acme/api"),
      project("site", "github.com/maria/site"),
    ]);
    expect(
      summariseAccountRules(overrides, repositories).map((rule) => [
        rule.pattern,
        rule.matches.length,
      ]),
    ).toEqual([
      ["github.com/acme/web", 1],
      ["github.com/acme/*", 1],
      ["github.com/*", 1],
    ]);
  });

  it("only mentions the unpinned repositories when there are some", () => {
    expect(repositoryAccountSummary(0, 15)).toBe("15 repositories, none pinned by a rule yet.");
    expect(repositoryAccountSummary(2, 15)).toBe(
      "2 of 15 repositories pinned by a rule; the rest use the active account.",
    );
    // Nothing is left over once every repository is pinned.
    expect(repositoryAccountSummary(15, 15)).toBe("15 repositories, all pinned by a rule.");
    expect(repositoryAccountSummary(1, 1)).toBe("1 repository, all pinned by a rule.");
    expect(repositoryAccountSummary(0, 1)).toBe("1 repository, none pinned by a rule yet.");
  });

  it("renames a rule without leaving the old pattern behind", () => {
    const renamed = updateAccountRules(overrides, {
      pattern: "github.com/acme-inc/*",
      login: "work",
      originalPattern: "github.com/acme/*",
    });
    expect(renamed).toEqual({
      "github.com/*": "personal",
      "github.com/acme-inc/*": "work",
      "github.com/acme/web": "release-bot",
    });
    expect(
      updateAccountRules(renamed, { pattern: "github.com/*", login: "", remove: true }),
    ).toEqual({ "github.com/acme-inc/*": "work", "github.com/acme/web": "release-bot" });
  });

  it("lowercases a saved pattern and ignores an incomplete edit", () => {
    expect(updateAccountRules({}, { pattern: "GitHub.com/Acme/*", login: " work " })).toEqual({
      "github.com/acme/*": "work",
    });
    expect(updateAccountRules({}, { pattern: "github.com/acme/*", login: "  " })).toEqual({});
  });

  it("explains why a pattern cannot be saved", () => {
    expect(accountRulePatternError("", overrides)).toContain("Enter a repository");
    expect(accountRulePatternError("github.com", overrides)).toContain("host/owner/repository");
    expect(accountRulePatternError("github.com//web", overrides)).toContain("empty path segment");
    expect(accountRulePatternError("*/acme/web", overrides)).toContain("Name a host");
    expect(accountRulePatternError("github.com/acme/*", overrides)).toContain("already a rule");
    // Editing a rule without changing its pattern is not a duplicate of itself.
    expect(accountRulePatternError("github.com/acme/*", overrides, "github.com/acme/*")).toBeNull();
    expect(accountRulePatternError("github.com/other/*", overrides)).toBeNull();
  });
});
