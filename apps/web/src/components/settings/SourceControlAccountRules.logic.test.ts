import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountRulePatternError,
  knownRepositories,
  resolveRepositoryAccounts,
  sortAccountRules,
  summariseAccountRules,
  updateAccountRules,
} from "./SourceControlAccountRules.logic";

const project = (title: string, canonicalKey?: string, provider = "github") => ({
  title,
  ...(canonicalKey === undefined
    ? {}
    : {
        repositoryIdentity: { canonicalKey, provider: SourceControlProviderKind.make(provider) },
      }),
});

describe("source control account rules", () => {
  const rules = {
    "github.com/*": "personal",
    "github.com/acme/*": "work",
    "github.com/acme/web": "release-bot",
  };

  it("orders rules most specific first, independent of the settings file", () => {
    expect(sortAccountRules(rules).map((rule) => rule.pattern)).toEqual([
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
    ]);
    expect(repositories.map((entry) => [entry.canonicalKey, entry.projectTitles])).toEqual([
      ["github.com/acme/web", ["web", "web worktree"]],
    ]);
  });

  it("reports each repository's account, the rule that decided, and hosts that cannot honor it", () => {
    const resolved = resolveRepositoryAccounts(
      { ...rules, "gitlab.com/group/*": "maria" },
      knownRepositories([
        project("web", "github.com/acme/web"),
        project("api", "github.com/acme/api"),
        project("site", "github.com/maria/site"),
        project("ops", "gitlab.com/group/ops", "gitlab"),
        project("docs", "codeberg.org/maria/docs", "forgejo"),
      ]),
    );
    expect(
      resolved.map((entry) => [
        entry.canonicalKey,
        entry.login,
        entry.pattern,
        entry.unsupportedHost,
      ]),
    ).toEqual([
      ["codeberg.org/maria/docs", null, null, null],
      ["github.com/acme/api", "work", "github.com/acme/*", null],
      ["github.com/acme/web", "release-bot", "github.com/acme/web", null],
      ["github.com/maria/site", "personal", "github.com/*", null],
      ["gitlab.com/group/ops", "maria", "gitlab.com/group/*", "GitLab"],
    ]);
    expect(
      summariseAccountRules(rules, resolved).map((rule) => [rule.pattern, rule.matches.length]),
    ).toEqual([
      ["github.com/acme/web", 1],
      ["github.com/acme/*", 1],
      ["github.com/*", 1],
    ]);
  });

  it("renames a rule without leaving the old pattern behind", () => {
    expect(
      updateAccountRules(rules, {
        pattern: "GitHub.com/Acme-Inc/*",
        login: " work ",
        originalPattern: "github.com/acme/*",
      }),
    ).toEqual({
      "github.com/*": "personal",
      "github.com/acme-inc/*": "work",
      "github.com/acme/web": "release-bot",
    });
  });

  it("explains why a pattern cannot be saved", () => {
    expect(accountRulePatternError("", rules)).toContain("Enter a repository");
    expect(accountRulePatternError("github.com", rules)).toContain("host/owner/repository");
    expect(accountRulePatternError("github.com//web", rules)).toContain("empty path segment");
    expect(accountRulePatternError("*/acme/web", rules)).toContain("Name a host");
    expect(accountRulePatternError("github.com/acme/*", rules)).toContain("already a rule");
    expect(accountRulePatternError("github.com/acme/*", rules, "github.com/acme/*")).toBeNull();
  });
});
