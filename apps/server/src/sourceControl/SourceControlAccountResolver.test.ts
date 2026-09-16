import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DEFAULT_SERVER_SETTINGS, type SourceControlProviderKind } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import {
  matchSourceControlAccountOverride,
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

it("matches an override by repository, by owner, or by host, most specific first", () => {
  const overrides = {
    "github.com/advancedtomo/*": "hmelo-amix",
    "github.com/advancedtomo/ats-fw": "hendrickmelo",
    "github.com/*": "fallback-user",
    "codeberg.org/maria/site": "maria",
  };
  const matched = (key: string) => matchSourceControlAccountOverride(overrides, key);

  // The named repository wins over the pin covering its owner.
  assert.strictEqual(matched("github.com/advancedtomo/ats-fw"), "hendrickmelo");
  assert.strictEqual(matched("github.com/advancedtomo/ats-hw"), "hmelo-amix");
  // An owner nobody named falls back to the host-wide pin.
  assert.strictEqual(matched("github.com/someone/thing"), "fallback-user");
  assert.strictEqual(matched("codeberg.org/maria/site"), "maria");
  assert.isUndefined(matched("codeberg.org/maria/other"));
  // Keys and patterns compare case-insensitively, as hosts treat logins.
  assert.strictEqual(matched("GitHub.com/AdvancedTomo/ATS-FW"), "hendrickmelo");
  // An owner wildcard does not reach into a shorter path.
  assert.isUndefined(
    matchSourceControlAccountOverride({ "forgejo.local/maria/*": "maria" }, "forgejo.local/maria"),
  );
});

it("does not let the order of the settings file decide an override", () => {
  const entries = {
    "github.com/advancedtomo/ats-fw": "hendrickmelo",
    "github.com/advancedtomo/*": "hmelo-amix",
  };
  const reversed = Object.fromEntries(Object.entries(entries).toReversed());
  for (const overrides of [entries, reversed]) {
    assert.strictEqual(
      matchSourceControlAccountOverride(overrides, "github.com/advancedtomo/ats-fw"),
      "hendrickmelo",
    );
  }
});

it("lets a host-wide entry act as the default account for everything else", () => {
  const overrides = {
    "github.com/autonomix-medical/*": "hmelo-amix",
    "github.com/*": "hendrickmelo",
  };
  const matched = (key: string) => matchSourceControlAccountOverride(overrides, key);

  assert.strictEqual(matched("github.com/autonomix-medical/firmware"), "hmelo-amix");
  assert.strictEqual(matched("github.com/advancedtomo/ats-fw"), "hendrickmelo");
  assert.strictEqual(matched("github.com/hendrickmelo/cantinho"), "hendrickmelo");
  // The catch-all is bounded by its host, so another host still resolves on its own.
  assert.isUndefined(matched("codeberg.org/maria/site"));
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
