import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  resolveProjectProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderState,
  type ServerSettings,
} from "@t3tools/contracts";

/** The fields of a provider instance that decide whether and where a new thread can start. */
export interface ProviderSelectionEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly enabled: boolean;
  readonly status: ServerProviderState;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export function deriveProviderSelectionEntry(snapshot: ServerProvider) {
  return {
    instanceId: snapshot.instanceId,
    driverKind: snapshot.driver,
    enabled: snapshot.enabled,
    status: snapshot.status,
    isDefault: snapshot.instanceId === defaultInstanceIdForDriver(snapshot.driver),
    isAvailable: snapshot.availability !== "unavailable",
    models: snapshot.models,
  } satisfies ProviderSelectionEntry;
}

/** Disabled instances may retain ready status until reconciliation. */
export function isProviderInstancePickerReady(entry: ProviderSelectionEntry): boolean {
  return entry.enabled && entry.isAvailable && entry.status === "ready";
}

/** Picker order: each driver's default instance first, then its custom instances. */
export function sortProviderInstanceEntries<T extends ProviderSelectionEntry>(
  entries: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const byKind = new Map<ProviderDriverKind, T[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKind.set(entry.driverKind, [entry]);
    }
  }
  const sorted: T[] = [];
  for (const bucket of byKind.values()) {
    sorted.push(
      ...bucket.filter((entry) => entry.isDefault),
      ...bucket.filter((entry) => !entry.isDefault),
    );
  }
  return sorted;
}

const isSelectableProviderInstanceEntry = (entry: ProviderSelectionEntry): boolean =>
  entry.enabled && entry.isAvailable;

export function resolveSelectableProviderInstanceEntry<T extends ProviderSelectionEntry>(
  entries: ReadonlyArray<T>,
  instanceId: ProviderInstanceId | undefined,
): T | undefined {
  if (instanceId !== undefined) {
    const requested = entries.find((entry) => entry.instanceId === instanceId);
    if (requested && isSelectableProviderInstanceEntry(requested)) {
      return requested;
    }
  }
  return (
    entries.find(isProviderInstancePickerReady) ??
    entries.find((entry) => isSelectableProviderInstanceEntry(entry) && entry.status !== "error")
  );
}

export function getDefaultProviderInstanceModel(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): string | undefined {
  const snapshot = providers.find((provider) => provider.instanceId === instanceId);
  if (!snapshot) return undefined;
  return (
    snapshot.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    snapshot.models.find((model) => !model.isCustom)?.slug ??
    snapshot.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[snapshot.driver]
  );
}

/** The model the composer preselects for a new thread when nothing is configured or sticky. */
export function resolveProjectDefaultProviderModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
): ModelSelection | null {
  const entries = sortProviderInstanceEntries(
    providers.map((snapshot) => {
      const entry = deriveProviderSelectionEntry(snapshot);
      const enabled = resolveProjectProviderInstanceEnabled(settings, projectId, entry.instanceId);
      return enabled === entry.enabled ? entry : { ...entry, enabled };
    }),
  );
  // Matches the composer: the first driver group wins before any other.
  const entry =
    resolveSelectableProviderInstanceEntry(
      entries.filter((candidate) => candidate.driverKind === entries[0]?.driverKind),
      undefined,
    ) ?? resolveSelectableProviderInstanceEntry(entries, undefined);
  const model = entry ? getDefaultProviderInstanceModel(providers, entry.instanceId) : undefined;
  return entry && model ? { instanceId: entry.instanceId, model } : null;
}
