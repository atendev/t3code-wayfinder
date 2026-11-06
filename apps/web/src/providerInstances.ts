import { pipe } from "effect/Function";
import {
  resolveProjectProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerSettings,
  type ServerProviderState,
} from "@t3tools/contracts";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@t3tools/client-runtime/state/provider-instance-display";
import {
  deriveProviderSelectionEntry,
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  resolveProjectDefaultProviderModelSelection,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
} from "@t3tools/shared/providerModelDefault";

export {
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  normalizeProviderAccentColor,
  resolveProjectDefaultProviderModelSelection,
  resolveSelectableProviderInstanceEntry,
  shouldShowInstanceBadge,
};

/** Placeholder for untargetable drafts. Never persist or dispatch it; disable send until replaced. */
export const NO_PROVIDER_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("t3code_no_provider"),
  model: "",
};

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: ServerProviderState;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export function isProviderInstancePickerVisible(entry: ProviderInstanceEntry): boolean {
  return entry.enabled;
}

export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const driverKind = snapshot.driver;
    return {
      ...deriveProviderSelectionEntry(snapshot),
      displayName: resolveProviderInstanceDisplayName(snapshot),
      accentColor: normalizeProviderAccentColor(snapshot.accentColor),
      ...(driverKind === "acpRegistry" && snapshot.iconUrl
        ? { acpRegistryIconUrl: snapshot.iconUrl }
        : {}),
      continuationGroupKey: snapshot.continuation?.groupKey,
      installed: snapshot.installed,
      snapshot,
    } satisfies ProviderInstanceEntry;
  });
}

/** Instance ids repeat across environments; lookups must stay scoped. */
export function deriveProviderEntriesByEnvironment(
  providersByEnvironment: Iterable<
    readonly [
      string,
      ReadonlyArray<ServerProvider>,
      Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">?,
    ]
  >,
): ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>> {
  const byEnvironment = new Map<string, ReadonlyMap<string, ProviderInstanceEntry>>();
  for (const [environmentId, providers, settings] of providersByEnvironment) {
    const derived = deriveProviderInstanceEntries(providers);
    const entries = settings ? brandProviderInstanceEntries(derived, settings) : derived;
    byEnvironment.set(
      environmentId,
      new Map(entries.map((entry) => [entry.instanceId as string, entry] as const)),
    );
  }
  return byEnvironment;
}

// The snapshot includes instances enabled by any project; machine settings alone do not.
export function brandProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances">,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.map((entry) => applyProviderInstanceBranding(entry, settings));
}

/** projectId applies project overrides; explicit null uses machine settings. */
export function applyProviderInstanceSettings(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.map((entry) => {
    const enabled = resolveProjectProviderInstanceEnabled(settings, projectId, entry.instanceId);
    return applyProviderInstanceBranding(
      enabled === entry.enabled ? entry : { ...entry, enabled },
      settings,
    );
  });
}

function applyProviderInstanceBranding(
  entry: ProviderInstanceEntry,
  settings: Pick<ServerSettings, "providerInstances">,
): ProviderInstanceEntry {
  const explicitInstance = Object.hasOwn(settings.providerInstances, entry.instanceId)
    ? settings.providerInstances[entry.instanceId]
    : undefined;
  if (entry.driverKind !== "acpRegistry" || explicitInstance === undefined) return entry;
  const config =
    explicitInstance.config !== null && typeof explicitInstance.config === "object"
      ? (explicitInstance.config as Readonly<Record<string, unknown>>)
      : null;
  if (config?.source === "local") {
    return { ...entry, acpRegistryAgentId: undefined, acpRegistryIconUrl: undefined };
  }
  const agentId = config?.agentId;
  const iconUrl = config?.registryIconUrl;
  return {
    ...entry,
    ...(typeof agentId === "string" && agentId.trim()
      ? { acpRegistryAgentId: agentId.trim() }
      : {}),
    ...(typeof iconUrl === "string" && iconUrl.trim()
      ? { acpRegistryIconUrl: iconUrl.trim() }
      : {}),
  };
}

/** Picker order: each driver's default instance first, then its custom instances. */
export function providerInstanceEntriesFor(
  providers: ReadonlyArray<ServerProvider>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return pipe(
    deriveProviderInstanceEntries(providers),
    (entries) => applyProviderInstanceSettings(entries, settings, projectId),
    sortProviderInstanceEntries,
  );
}

export function resolveSelectableProviderInstance(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceId | undefined {
  const entries = deriveProviderInstanceEntries(providers);
  return resolveSelectableProviderInstanceEntry(entries, instanceId)?.instanceId;
}

export function resolveDefaultProviderModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  const instanceId = resolveSelectableProviderInstance(providers, selection?.instanceId);
  if (instanceId === undefined) return null;
  if (selection?.instanceId === instanceId) return selection;
  const model = getDefaultProviderInstanceModel(providers, instanceId);
  return model ? { instanceId, model } : null;
}
