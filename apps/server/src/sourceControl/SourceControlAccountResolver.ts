import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import type { SourceControlProviderKind } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import {
  matchSourceControlAccountOverride,
  type PinnedSourceControlAccountValue,
  SourceControlAccountUnsupportedError,
  sourceControlAccountSupport,
} from "./SourceControlAccount.ts";

/**
 * Which account a repository's source control operations run as. The answer comes from
 * `sourceControlAccountOverrides` in the server settings and nothing else: no account is
 * inferred, so a repository nobody pinned keeps using whichever account the CLI has active,
 * exactly as it did before. A pin naming a provider that cannot select an account by name
 * fails rather than being silently ignored.
 */
export class SourceControlAccountResolver extends Context.Service<
  SourceControlAccountResolver,
  {
    readonly resolve: (input: {
      readonly kind: SourceControlProviderKind;
      /** The account boundary: the host the repository lives on. */
      readonly host: string;
      /** The repository's canonical key, `host/owner/repo`. */
      readonly canonicalKey: string;
    }) => Effect.Effect<
      PinnedSourceControlAccountValue | null,
      SourceControlAccountUnsupportedError
    >;
  }
>()("t3/sourceControl/SourceControlAccountResolver") {}

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;

  const resolve: SourceControlAccountResolver["Service"]["resolve"] = Effect.fn(
    "SourceControlAccountResolver.resolve",
  )(function* (input) {
    const overrides = yield* settings.getSettings.pipe(
      Effect.map((current) => current.sourceControlAccountOverrides),
      // An unreadable settings file is reported elsewhere; source control keeps working on the
      // active account rather than failing every repository behind it.
      Effect.orElseSucceed(() => ({}) as Readonly<Record<string, string>>),
    );
    const login = matchSourceControlAccountOverride(
      overrides,
      canonicalRepositoryKey(input.canonicalKey.toLowerCase()),
    );
    if (login === undefined) return null;
    const support = sourceControlAccountSupport(input.kind);
    if (!support.supported) {
      return yield* new SourceControlAccountUnsupportedError({
        provider: input.kind,
        login,
        reason: support.reason,
      });
    }
    return { host: input.host, login };
  });

  return SourceControlAccountResolver.of({ resolve });
});

export const layer = Layer.effect(SourceControlAccountResolver, make);
