import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * The login one operation acts as, from the repository's account rule. A provider whose
 * definition sets `selectsAccountPerRepository` honors it for requests to `host` in place of the
 * host's own account choice. It names a login, never a token, so it may appear in logs.
 */
export interface SourceControlAccountSelection {
  readonly host: string;
  readonly login: string;
}

export const SelectedSourceControlAccount = Context.Reference<SourceControlAccountSelection | null>(
  "@t3tools/source-control-core/server/SourceControlAccount/SelectedSourceControlAccount",
  { defaultValue: () => null },
);

/** The selection's login when it is for `host`, which a request to any other host must ignore. */
export const selectedLoginFor = (host: string) =>
  Effect.map(SelectedSourceControlAccount, (selection) =>
    selection !== null && selection.host === host.trim().toLowerCase()
      ? selection.login
      : undefined,
  );

export const withSourceControlAccount =
  (selection: SourceControlAccountSelection | null) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, SelectedSourceControlAccount, selection);
