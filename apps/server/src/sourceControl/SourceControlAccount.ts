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
