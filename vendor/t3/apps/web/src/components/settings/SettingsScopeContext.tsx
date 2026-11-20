import { useAtomValue } from "@effect/atom-react";
import { createContext, type ReactNode, useContext } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";
import {
  applyPendingScopedWrites,
  pendingScopedWritesAtom,
  resolveScopedSettingsTargets,
  selectScopedSettingsEnvironments,
} from "./scopedSettings";
import { resolveSettingsScope, type SettingsScopeSearch } from "./settingsScope";

function useResolvedSettingsScope() {
  const groups = useSettingsProjectGroups();
  const { environments: available } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environments = available.filter((entry) => entry.environmentId === primaryEnvironmentId);
  const search: SettingsScopeSearch = primaryEnvironmentId ? { machine: primaryEnvironmentId } : {};
  const scope = resolveSettingsScope(search, groups, environments);
  const pendingWrites = useAtomValue(pendingScopedWritesAtom);
  const selected = selectScopedSettingsEnvironments(scope, environments, primaryEnvironmentId);
  const targets = resolveScopedSettingsTargets(
    scope,
    applyPendingScopedWrites(selected.connectedEnvironments, pendingWrites),
    new Map(),
  );
  return { scope, groups, search, ...selected, targets, target: targets[0] ?? null };
}

const SettingsScopeContext = createContext<
  | (ReturnType<typeof useResolvedSettingsScope> & {
      singleEnvironment: boolean;
      deviceOnly: boolean;
      search: SettingsScopeSearch;
      selectScope: (next: SettingsScopeSearch) => void;
    })
  | null
>(null);

export function SettingsScopeProvider({
  children,
  deviceOnly = false,
}: {
  singleEnvironment?: boolean;
  deviceOnly?: boolean;
  search: SettingsScopeSearch;
  onChange: (next: SettingsScopeSearch) => void;
  children: ReactNode;
}) {
  const resolved = useResolvedSettingsScope();
  const value = {
    ...resolved,
    singleEnvironment: true,
    deviceOnly,
    selectScope: (_next: SettingsScopeSearch) => {},
  };
  return <SettingsScopeContext value={value}>{children}</SettingsScopeContext>;
}

export function useOptionalSettingsScope() {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope() {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings scope must be read inside SettingsScopeProvider.");
  return scope;
}
