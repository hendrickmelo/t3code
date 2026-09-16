import { useState } from "react";
import { ChevronDownIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type {
  SourceControlDiscoveryResult,
  SourceControlProviderAccount,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { useProjects } from "../../state/entities";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { RedactedSensitiveText, redactedPlaceholder } from "./RedactedSensitiveText";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import {
  accountRulePatternError,
  knownRepositories,
  repositoryAccountSummary,
  resolveRepositoryAccounts,
  summariseAccountRules,
  updateAccountRules,
} from "./sourceControlAccountRules.logic";

function accountOptions(
  discovery: SourceControlDiscoveryResult,
): ReadonlyArray<SourceControlProviderAccount> {
  const seen = new Map<string, SourceControlProviderAccount>();
  for (const item of discovery.sourceControlProviders) {
    for (const account of item.auth.accounts ?? []) {
      seen.set(`${account.host}/${account.login}`, account);
    }
  }
  return [...seen.values()].toSorted(
    (left, right) => left.host.localeCompare(right.host) || left.login.localeCompare(right.login),
  );
}

/** Which provider serves a host, so a rule can say when the provider cannot select accounts. */
function providerKinds(
  discovery: SourceControlDiscoveryResult,
): (host: string) => SourceControlProviderKind | undefined {
  const byHost = new Map<string, SourceControlProviderKind>();
  for (const item of discovery.sourceControlProviders) {
    const host = Option.getOrNull(item.auth.host);
    if (host !== null) byHost.set(host.toLowerCase(), item.kind);
    for (const account of item.auth.accounts ?? []) {
      byHost.set(account.host.toLowerCase(), item.kind);
    }
  }
  return (host) => byHost.get(host.toLowerCase());
}

function RuleRow(props: {
  readonly pattern: string;
  readonly login: string;
  readonly matchCount: number;
  readonly accounts: ReadonlyArray<SourceControlProviderAccount>;
  readonly overrides: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly onSave: (next: Record<string, string>) => void;
}) {
  const [pattern, setPattern] = useState(props.pattern);
  const [error, setError] = useState<string | null>(null);

  const commitPattern = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    // An untouched existing rule needs no validation; a still-empty new one does, so the reader
    // is told what to type rather than left with a row that silently saves nothing.
    if (trimmed === props.pattern && trimmed !== "") {
      setError(null);
      return;
    }
    const problem = accountRulePatternError(trimmed, props.overrides, props.pattern);
    setError(problem);
    if (problem !== null) return;
    props.onSave(
      updateAccountRules(props.overrides, {
        pattern: trimmed,
        login: props.login,
        originalPattern: props.pattern,
      }),
    );
  };

  return (
    <div className="border-t border-border/50 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          className="min-w-0 flex-1 font-mono"
          value={pattern}
          spellCheck={false}
          disabled={props.disabled}
          aria-label="Repository pattern"
          onChange={(event) => setPattern(event.target.value)}
          onBlur={(event) => commitPattern(event.target.value)}
        />
        <Select
          value={props.login}
          disabled={props.disabled}
          onValueChange={(value) => {
            if (typeof value !== "string" || value === props.login) return;
            props.onSave(
              updateAccountRules(props.overrides, { pattern: props.pattern, login: value }),
            );
          }}
        >
          {/* The account is hidden the way the rest of the page hides one: a scrambled stand-in
              of the same shape, so there is no real login on the page to read. Opening the list
              is the reveal, and it is also how the account is changed. */}
          <SelectTrigger
            size="sm"
            className="w-44 shrink-0"
            aria-label={`Account for ${props.pattern === "" ? "this rule" : props.pattern}`}
          >
            <span className="flex-1 select-none truncate text-start font-mono text-[11px] leading-none text-muted-foreground blur-[2px]">
              {redactedPlaceholder(props.login)}
            </span>
          </SelectTrigger>
          <SelectPopup>
            <SelectContent>
              {props.accounts.some((account) => account.login === props.login) ? null : (
                <SelectItem value={props.login}>{props.login}</SelectItem>
              )}
              {props.accounts.map((account) => (
                <SelectItem key={`${account.host}/${account.login}`} value={account.login}>
                  {account.login}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectPopup>
        </Select>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          disabled={props.disabled}
          aria-label={`Remove rule ${props.pattern}`}
          onClick={() =>
            props.onSave(
              updateAccountRules(props.overrides, {
                pattern: props.pattern,
                login: props.login,
                remove: true,
              }),
            )
          }
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      {error === null ? (
        <p className="pt-1 text-xs text-muted-foreground">
          {props.matchCount === 0
            ? "No repository here matches this yet."
            : `Decides ${props.matchCount} ${props.matchCount === 1 ? "repository" : "repositories"}.`}
        </p>
      ) : (
        <p role="alert" className="pt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Web-only: account rules are per-server machine configuration rather than a synced user
 * preference, and mobile has no source control settings surface to hang them on.
 */
export function SourceControlAccountRules(props: {
  readonly discovery: SourceControlDiscoveryResult;
}) {
  const { scope } = useSettingsScope();
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const projects = useProjects();
  const [adding, setAdding] = useState(false);
  // Collapsed by default: the rules are the control, and the list below is for checking them.
  const [showRepositories, setShowRepositories] = useState(false);

  const overrides = settings.sourceControlAccountOverrides;
  const accounts = accountOptions(props.discovery);
  const repositories = knownRepositories(projects);
  const rules = summariseAccountRules(overrides, repositories);
  const resolved = resolveRepositoryAccounts(
    overrides,
    repositories,
    providerKinds(props.discovery),
  );
  const pinnedCount = resolved.filter((repository) => repository.login !== null).length;
  const save = (next: Record<string, string>) => {
    setAdding(false);
    updateSettings({ sourceControlAccountOverrides: next });
  };

  return (
    <SettingsSection title="Accounts">
      <SettingsRow
        {...searchableSetting("source-control-account-rules")}
        serverScoped
        settingKeys={["sourceControlAccountOverrides"]}
        description="Which signed-in account each repository acts as. Use * for any part of host/owner/repository; the most specific rule wins. Anything unmatched uses the account the tool has active."
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={projectScope || adding || accounts.length === 0}
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-3.5" aria-hidden /> Add rule
          </Button>
        }
      >
        <div className="pt-1 pb-2">
          {accounts.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Sign in to a provider that can select an account, such as GitHub, to add a rule.
            </p>
          ) : null}
          {rules.length === 0 && !adding ? (
            <p className="py-2 text-sm text-muted-foreground">
              No rules. Every repository uses the active account.
            </p>
          ) : null}
          {rules.map((rule) => (
            <RuleRow
              key={rule.pattern}
              pattern={rule.pattern}
              login={rule.login}
              matchCount={rule.matches.length}
              accounts={accounts}
              overrides={overrides}
              disabled={projectScope}
              onSave={save}
            />
          ))}
          {adding ? (
            <RuleRow
              key="new-rule"
              pattern=""
              login={accounts[0]?.login ?? ""}
              matchCount={0}
              accounts={accounts}
              overrides={overrides}
              disabled={projectScope}
              onSave={save}
            />
          ) : null}
        </div>
      </SettingsRow>

      {repositories.length === 0 ? null : (
        <SettingsRow
          title="Repositories"
          description={repositoryAccountSummary(pinnedCount, repositories.length)}
          control={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              onClick={() => setShowRepositories((open) => !open)}
              aria-expanded={showRepositories}
              aria-label="Toggle the repository list"
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", showRepositories && "rotate-180")}
              />
            </Button>
          }
        >
          <Collapsible open={showRepositories} onOpenChange={setShowRepositories}>
            <CollapsibleContent>
              <div className="pt-1 pb-2">
                {resolved.map((repository) => (
                  <div
                    key={repository.canonicalKey}
                    className="flex items-center gap-2 border-t border-border/50 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{repository.canonicalKey}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {repository.projectTitles.join(", ")}
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-right">
                      {repository.unsupportedReason === null ? null : (
                        <TriangleAlertIcon
                          className="size-3.5 shrink-0 text-warning"
                          aria-label={repository.unsupportedReason}
                        />
                      )}
                      <div className="min-w-0">
                        {repository.login === null ? (
                          <p className="truncate text-xs text-muted-foreground">Active account</p>
                        ) : (
                          <RedactedSensitiveText
                            value={repository.login}
                            ariaLabel={`Toggle the account for ${repository.canonicalKey}`}
                            revealTooltip="Click to reveal account"
                            hideTooltip="Click to hide account"
                          />
                        )}
                        {repository.pattern === null ? null : (
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {repository.pattern}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
