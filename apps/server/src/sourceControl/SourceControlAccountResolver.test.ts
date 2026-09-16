import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DEFAULT_SERVER_SETTINGS, type SourceControlProviderKind } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import {
  PinnedSourceControlAccount,
  withPinnedSourceControlAccount,
} from "./SourceControlAccount.ts";
import * as SourceControlAccountResolver from "./SourceControlAccountResolver.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";

function makeResolver(overrides: Record<string, string>) {
  return SourceControlAccountResolver.make.pipe(
    Effect.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlAccountOverrides: overrides,
        }),
      }),
    ),
  );
}

const pin = (kind: SourceControlProviderKind, host: string, canonicalKey: string) => ({
  kind,
  host,
  canonicalKey,
});

it.effect("pins a whole organisation and leaves everything else on the active account", () =>
  Effect.gen(function* () {
    const resolver = yield* makeResolver({ "github.com/advancedtomo/*": "hmelo-amix" });

    for (const repository of ["ats-fw", "ats-hw"]) {
      assert.deepStrictEqual(
        yield* resolver.resolve(
          pin("github", "github.com", `github.com/advancedtomo/${repository}`),
        ),
        { host: "github.com", login: "hmelo-amix" },
      );
    }
    // Nothing is inferred, so an unpinned repository keeps today's behaviour.
    assert.isNull(
      yield* resolver.resolve(pin("github", "github.com", "github.com/hendrickmelo/cantinho")),
    );
  }),
);

it.effect("reports a pin on a provider that cannot select accounts instead of ignoring it", () =>
  Effect.gen(function* () {
    const resolver = yield* makeResolver({ "gitlab.com/group/*": "maria" });

    const error = yield* Effect.flip(
      resolver.resolve(pin("gitlab", "gitlab.com", "gitlab.com/group/ops")),
    );
    assert.strictEqual(error._tag, "SourceControlAccountUnsupportedError");
    assert.strictEqual(error.provider, "gitlab");
    assert.strictEqual(error.login, "maria");
    assert.include(error.reason, "store credentials");
    // Without a pin the unsupported provider is left alone rather than failing.
    assert.isNull(yield* resolver.resolve(pin("gitlab", "gitlab.com", "gitlab.com/other/ops")));
  }),
);

it.effect("runs a wrapped provider's calls as the pinned account", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = [];
    const record = Effect.gen(function* () {
      seen.push((yield* PinnedSourceControlAccount)?.login ?? null);
    });
    const provider = SourceControlProvider.SourceControlProvider.of({
      kind: "github",
      listChangeRequests: () => Effect.succeed([]),
      getChangeRequest: () => Effect.die("unused"),
      createChangeRequest: () => record,
      getRepositoryCloneUrls: () => Effect.die("unused"),
      createRepository: () => Effect.die("unused"),
      getDefaultBranch: () => Effect.as(record, null),
      checkoutChangeRequest: () => Effect.void,
    });
    const call = (login: string | null) => {
      const wrapped = withPinnedSourceControlAccount(
        provider,
        Effect.succeed(login === null ? null : { host: "github.com", login }),
      );
      return Effect.andThen(
        wrapped.getDefaultBranch({ cwd: "/w" }),
        wrapped.createChangeRequest({
          cwd: "/w",
          baseRefName: "main",
          headSelector: "feature",
          title: "Title",
          bodyFile: "/tmp/body",
        }),
      );
    };

    yield* call("maria-work");
    yield* call(null);

    assert.deepStrictEqual(seen, ["maria-work", "maria-work", null, null]);
  }),
);
