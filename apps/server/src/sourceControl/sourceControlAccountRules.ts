import { SourceControlProviderKind, type ServerSettings } from "@t3tools/contracts";
import {
  matchSourceControlAccountRule,
  sourceControlAccountRuleHost,
} from "@t3tools/source-control-core/shared/accountRules";
import type { SourceControlAccountSelection } from "@t3tools/source-control-core/server/SourceControlAccount";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { sourceControlDefinitions } from "./sourceControlDefinitions.ts";

export class SourceControlAccountUnsupportedError extends Schema.TaggedError<SourceControlAccountUnsupportedError>()(
  "SourceControlAccountUnsupportedError",
  { provider: SourceControlProviderKind, pattern: Schema.String, login: Schema.String },
) {
  override get message(): string {
    return `The account rule ${this.pattern} names ${this.login}, but ${sourceControlDefinitions.get(this.provider).label} can only use the account its CLI has active. Remove the rule in Settings → Source control.`;
  }
}

/**
 * The account a repository's operations act as, from `sourceControlAccountOverrides`, or null to
 * keep the host's own account choice. A rule for a host that cannot select a login fails rather
 * than quietly running as the active one.
 */
export const sourceControlAccountFor = (input: {
  readonly settings: Pick<ServerSettings, "sourceControlAccountOverrides">;
  readonly kind: SourceControlProviderKind;
  /** `repositoryIdentity.canonicalKey`, `host/owner/repo`. */
  readonly repositoryKey: string;
}): Result.Result<SourceControlAccountSelection | null, SourceControlAccountUnsupportedError> => {
  if (Object.keys(input.settings.sourceControlAccountOverrides).length === 0) {
    return Result.succeed(null);
  }
  const rule = matchSourceControlAccountRule(
    input.settings.sourceControlAccountOverrides,
    input.repositoryKey,
  );
  if (rule === undefined) return Result.succeed(null);
  if (sourceControlDefinitions.get(input.kind).selectsAccountPerRepository !== true) {
    return Result.fail(new SourceControlAccountUnsupportedError({ provider: input.kind, ...rule }));
  }
  return Result.succeed({
    host: sourceControlAccountRuleHost(input.repositoryKey),
    login: rule.login,
  });
};
