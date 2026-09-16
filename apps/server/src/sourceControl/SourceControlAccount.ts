import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { SourceControlProviderError, SourceControlProviderKind } from "@t3tools/contracts";

import type * as SourceControlProvider from "./SourceControlProvider.ts";

/**
 * The account one operation should run as: a non-secret login the provider translates into
 * its own selection mechanism (`gh auth token --user`, `tea --login`). It never carries a
 * token, so unlike `PinnedGitHubCredential` it may appear in logs and errors.
 */
export interface PinnedSourceControlAccountValue {
  readonly host: string;
  readonly login: string;
}

export const PinnedSourceControlAccount = Context.Reference<PinnedSourceControlAccountValue | null>(
  "t3/sourceControl/PinnedSourceControlAccount",
  { defaultValue: () => null },
);

export type SourceControlAccountSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string };

/**
 * Whether a provider can act as a named account without T3 Code holding a credential.
 * The unsupported providers only read a token from the environment, so pinning an account
 * for them would mean storing credentials, which the server deliberately does not do.
 */
export function sourceControlAccountSupport(
  kind: SourceControlProviderKind,
): SourceControlAccountSupport {
  switch (kind) {
    case "github":
    case "forgejo":
      return { supported: true };
    case "gitlab":
      return {
        supported: false,
        reason:
          "glab reads its token from the environment (GITLAB_TOKEN) and has no per-account selection; pinning would require T3 Code to store credentials.",
      };
    case "azure-devops":
      return {
        supported: false,
        reason:
          "az devops reads AZURE_DEVOPS_EXT_PAT and has no account selection; pinning would require T3 Code to store credentials.",
      };
    case "bitbucket":
      return {
        supported: false,
        reason:
          "Bitbucket uses server-wide environment credentials and has no account selection; pinning would require T3 Code to store credentials.",
      };
    case "unknown":
      return { supported: false, reason: "The repository host is not a known provider." };
  }
}

export class SourceControlAccountUnsupportedError extends Schema.TaggedError<SourceControlAccountUnsupportedError>()(
  "SourceControlAccountUnsupportedError",
  {
    provider: SourceControlProviderKind,
    login: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `The ${this.provider} provider cannot act as the pinned account "${this.login}": ${this.reason}`;
  }
}

/**
 * Whether an override key covers a repository. `*` stands for one path segment, and a trailing
 * `*` covers the rest of the path, so `github.com/acme/*` names every repository of one owner.
 * Both sides arrive canonical and lowercased.
 */
function overrideMatches(pattern: ReadonlyArray<string>, key: ReadonlyArray<string>): boolean {
  for (const [index, segment] of pattern.entries()) {
    const last = index === pattern.length - 1;
    if (segment === "*") {
      // A trailing wildcard takes whatever is left, which must be at least one segment.
      if (last) return key.length > index;
      if (key[index] === undefined) return false;
      continue;
    }
    if (key[index] !== segment) return false;
    if (last && key.length !== pattern.length) return false;
  }
  return pattern.length === key.length;
}

/**
 * The login pinned for a repository, or undefined where none is. The most specific key wins, so
 * naming one repository overrides a pin covering its whole owner however the file is ordered.
 */
export function matchSourceControlAccountOverride(
  overrides: Readonly<Record<string, string>>,
  canonicalKey: string,
): string | undefined {
  const key = canonicalKey.toLowerCase().split("/");
  let best: { readonly pattern: string; readonly login: string; readonly literals: number } | null =
    null;
  for (const [pattern, login] of Object.entries(overrides)) {
    const segments = pattern.trim().toLowerCase().split("/");
    if (!overrideMatches(segments, key)) continue;
    const literals = segments.filter((segment) => segment !== "*").length;
    // Ordering by key keeps two equally specific patterns from depending on file order.
    if (
      best === null ||
      literals > best.literals ||
      (literals === best.literals && pattern < best.pattern)
    ) {
      best = { pattern, login, literals };
    }
  }
  return best?.login;
}

/**
 * Every call this provider makes runs as `account`, which is resolved once per call rather than
 * bound here: a provider is held per working directory and outlives an account switch.
 */
export function withPinnedSourceControlAccount(
  provider: SourceControlProvider.SourceControlProvider["Service"],
  account: Effect.Effect<PinnedSourceControlAccountValue | null, SourceControlProviderError>,
): SourceControlProvider.SourceControlProvider["Service"] {
  const as = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(account, (pinned) =>
      Effect.provideService(effect, PinnedSourceControlAccount, pinned),
    );
  return {
    kind: provider.kind,
    ...(provider.resolveLink === undefined
      ? {}
      : {
          resolveLink: (input) => {
            const resolved = provider.resolveLink?.(input);
            return resolved === undefined ? undefined : as(resolved);
          },
        }),
    listChangeRequests: (input) => as(provider.listChangeRequests(input)),
    getChangeRequest: (input) => as(provider.getChangeRequest(input)),
    createChangeRequest: (input) => as(provider.createChangeRequest(input)),
    getRepositoryCloneUrls: (input) => as(provider.getRepositoryCloneUrls(input)),
    createRepository: (input) => as(provider.createRepository(input)),
    getDefaultBranch: (input) => as(provider.getDefaultBranch(input)),
    checkoutChangeRequest: (input) => as(provider.checkoutChangeRequest(input)),
  };
}
