import type { EnvironmentId, SourceControlDiscoveryResult } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { redactedPlaceholder } from "./RedactedSensitiveText";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  accountRulePatternError,
  knownRepositories,
  repositoryAccountSummary,
  resolveRepositoryAccounts,
  summariseAccountRules,
  updateAccountRules,
} from "./SourceControlAccountRules.logic";

function Login(props: { readonly login: string; readonly revealed: boolean }) {
  return props.revealed ? (
    <span className="min-w-0 truncate font-mono text-2xs">{props.login}</span>
  ) : (
    <span className="min-w-0 truncate font-mono text-2xs">
      <span className="select-none blur-xs" aria-hidden>
        {redactedPlaceholder(props.login)}
      </span>
      <span className="sr-only">Hidden account</span>
    </span>
  );
}

/** Signed-in logins a rule can name: a token from the environment cannot be selected by name. */
function selectableLogins(discovery: SourceControlDiscoveryResult): ReadonlyArray<string> {
  const logins = new Set<string>();
  for (const item of discovery.sourceControlProviders) {
    for (const entry of item.auth.accounts ?? []) {
      if (entry.authenticated && entry.environmentVariable === undefined) logins.add(entry.account);
    }
  }
  return [...logins].toSorted((left, right) => left.localeCompare(right));
}

function RuleRow(props: {
  readonly pattern: string;
  readonly login: string;
  readonly matchCount: number;
  readonly logins: ReadonlyArray<string>;
  readonly rules: Readonly<Record<string, string>>;
  readonly revealed: boolean;
  readonly disabled: boolean;
  readonly onSave: (next: Record<string, string>) => void;
}) {
  const [pattern, setPattern] = useState(props.pattern);
  const [error, setError] = useState<string | null>(null);
  const logins = props.logins.includes(props.login) ? props.logins : [props.login, ...props.logins];

  const commitPattern = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === props.pattern && trimmed !== "") {
      setError(null);
      return;
    }
    const problem = accountRulePatternError(trimmed, props.rules, props.pattern);
    setError(problem);
    if (problem !== null) return;
    props.onSave(
      updateAccountRules(props.rules, {
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
          className="min-w-0 flex-1"
          value={pattern}
          placeholder="github.com/owner/*"
          spellCheck={false}
          disabled={props.disabled}
          aria-label="Repository pattern"
          onChange={(event) => setPattern(event.target.value)}
          onBlur={(event) => commitPattern(event.target.value)}
        />
        <div className="w-44 shrink-0">
          <Select
            value={props.login}
            disabled={props.disabled}
            onValueChange={(value) => {
              if (typeof value !== "string" || value === props.login) return;
              props.onSave(
                updateAccountRules(props.rules, { pattern: props.pattern, login: value }),
              );
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Account for ${props.pattern === "" ? "this rule" : props.pattern}`}
            >
              <SelectValue>
                {(value: string) => <Login login={value} revealed={props.revealed} />}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {logins.map((login) => (
                <SelectItem key={login} value={login}>
                  <Login login={login} revealed={props.revealed} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          disabled={props.disabled}
          aria-label={`Remove rule ${props.pattern}`}
          onClick={() =>
            props.onSave(
              updateAccountRules(props.rules, {
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
          {props.pattern === ""
            ? "Type a pattern, then leave the field to save."
            : props.matchCount === 0
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

/** Rules naming which signed-in login each repository acts as, on one environment. */
export function SourceControlAccountRules(props: {
  readonly environmentId: EnvironmentId;
  readonly discovery: SourceControlDiscoveryResult;
  readonly onSaved: () => void;
}) {
  const rules = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.sourceControlAccountOverrides,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save source control account rules",
  });
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showRepositories, setShowRepositories] = useState(false);

  const logins = selectableLogins(props.discovery);
  const resolved = resolveRepositoryAccounts(rules, knownRepositories(projects));
  const summaries = summariseAccountRules(rules, resolved);
  const ruledCount = resolved.filter((repository) => repository.login !== null).length;

  const save = async (next: Record<string, string>) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId: props.environmentId,
      input: { patch: { sourceControlAccountOverrides: next } },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setAdding(false);
      props.onSaved();
    }
  };

  return (
    <SettingsSection
      title="Accounts"
      headerAction={
        <Button
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? "Hide rule accounts" : "Reveal rule accounts"}
          aria-pressed={revealed}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      }
    >
      <SettingsRow
        {...searchableSetting("source-control-account-rules")}
        serverScoped
        settingKeys={["sourceControlAccountOverrides"]}
        description="Which signed-in GitHub or Forgejo login each repository acts as. Use * for any part of host/owner/repository; the most specific rule wins. Repositories no rule covers use their host's account."
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={saving || adding || logins.length === 0}
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-3.5" aria-hidden /> Add rule
          </Button>
        }
      >
        <div className="pt-1 pb-2">
          {logins.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Sign in to GitHub or Forgejo on the server, then rescan, to add a rule.
            </p>
          ) : summaries.length === 0 && !adding ? (
            <p className="py-2 text-sm text-muted-foreground">
              No rules. Every repository uses its host's account.
            </p>
          ) : null}
          {summaries.map((rule) => (
            <RuleRow
              key={rule.pattern}
              pattern={rule.pattern}
              login={rule.login}
              matchCount={rule.matches.length}
              logins={logins}
              rules={rules}
              revealed={revealed}
              disabled={saving}
              onSave={(next) => void save(next)}
            />
          ))}
          {adding && logins[0] !== undefined ? (
            <RuleRow
              key="new-rule"
              pattern=""
              login={logins[0]}
              matchCount={0}
              logins={logins}
              rules={rules}
              revealed={revealed}
              disabled={saving}
              onSave={(next) => void save(next)}
            />
          ) : null}
        </div>
      </SettingsRow>

      {resolved.length === 0 ? null : (
        <SettingsRow
          title="Repositories"
          description={repositoryAccountSummary(ruledCount, resolved.length)}
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
                      {repository.unsupportedHost === null ? null : (
                        <TriangleAlertIcon
                          className="size-3.5 shrink-0 text-warning"
                          aria-label={`${repository.unsupportedHost} cannot select an account, so this repository's source control fails until the rule is removed.`}
                        />
                      )}
                      <div className="grid min-w-0 justify-items-end">
                        {repository.login === null ? (
                          <span className="truncate text-xs text-muted-foreground">
                            Host's account
                          </span>
                        ) : (
                          <Login login={repository.login} revealed={revealed} />
                        )}
                        {repository.pattern === null ? null : (
                          <span className="truncate font-mono text-2xs text-muted-foreground">
                            {repository.pattern}
                          </span>
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
