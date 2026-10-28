import { describe, expect, it } from "vite-plus/test";
import { matchSourceControlAccountRule } from "./accountRules.ts";

describe("matchSourceControlAccountRule", () => {
  const rules = {
    "github.com/acme/*": "acme-bot",
    "github.com/acme/firmware": "octocat",
    "github.com/*": "fallback",
    "codeberg.org/maria/site": "maria",
  };
  const login = (key: string, from: Record<string, string> = rules) =>
    matchSourceControlAccountRule(from, key)?.login;

  it("prefers the most specific matching pattern", () => {
    expect(login("github.com/acme/firmware")).toBe("octocat");
    expect(login("github.com/acme/hardware")).toBe("acme-bot");
    expect(login("github.com/someone/thing")).toBe("fallback");
    expect(login("codeberg.org/maria/other")).toBeUndefined();
  });

  it("compares case-insensitively", () => {
    expect(login("GitHub.com/ACME/Firmware")).toBe("octocat");
  });

  it("does not let the settings file's key order decide", () => {
    const entries = { "github.com/acme/firmware": "octocat", "github.com/acme/*": "acme-bot" };
    const reversed = Object.fromEntries(Object.entries(entries).toReversed());
    expect(login("github.com/acme/firmware", entries)).toBe("octocat");
    expect(login("github.com/acme/firmware", reversed)).toBe("octocat");
  });

  it("does not let a trailing wildcard match an empty remainder", () => {
    expect(login("forgejo.local/maria", { "forgejo.local/maria/*": "maria" })).toBeUndefined();
  });

  it("lets a trailing wildcard cover nested group paths", () => {
    expect(login("gitlab.com/group/sub/repo", { "gitlab.com/group/*": "me" })).toBe("me");
  });

  it("reports the pattern that matched", () => {
    expect(matchSourceControlAccountRule(rules, "github.com/acme/hardware")).toEqual({
      pattern: "github.com/acme/*",
      login: "acme-bot",
    });
  });
});
