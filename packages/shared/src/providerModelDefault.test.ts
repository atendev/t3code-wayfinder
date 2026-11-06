import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectDefaultProviderModelSelection } from "./providerModelDefault.ts";

const provider = (input: {
  driver: string;
  instanceId: string;
  enabled?: boolean;
  availability?: ServerProvider["availability"];
  status?: ServerProvider["status"];
  models?: ReadonlyArray<{ slug: string; isCustom?: boolean; isDefault?: boolean }>;
}) =>
  ({
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    enabled: input.enabled ?? true,
    installed: true,
    status: input.status ?? "ready",
    ...(input.availability ? { availability: input.availability } : {}),
    models: (input.models ?? []).map((model) => ({ name: model.slug, capabilities: {}, ...model })),
  }) as unknown as ServerProvider;

const settings = {
  providerInstances: {
    [ProviderInstanceId.make("codex_work")]: { driver: ProviderDriverKind.make("codex") },
  },
  projectSettingsOverrides: {},
};
const resolve = (providers: ReadonlyArray<ServerProvider>, projectSettings = settings) =>
  resolveProjectDefaultProviderModelSelection(providers, projectSettings, null);

describe("resolveProjectDefaultProviderModelSelection", () => {
  it.each([
    {
      name: "no providers",
      providers: [],
      expected: null,
    },
    {
      name: "a first driver group with nothing selectable falls through to the next group",
      providers: [
        provider({ driver: "codex", instanceId: "codex", availability: "unavailable" }),
        provider({
          driver: "claudeAgent",
          instanceId: "claudeAgent",
          models: [{ slug: "sonnet" }],
        }),
      ],
      expected: { instanceId: "claudeAgent", model: "sonnet" },
    },
    {
      name: "a ready instance beats an earlier merely available one",
      providers: [
        provider({
          driver: "codex",
          instanceId: "codex",
          status: "warning",
          models: [{ slug: "a" }],
        }),
        provider({ driver: "codex", instanceId: "codex_work", models: [{ slug: "b" }] }),
      ],
      expected: { instanceId: "codex_work", model: "b" },
    },
    {
      name: "an error instance is skipped",
      providers: [
        provider({ driver: "codex", instanceId: "codex", status: "error" }),
        provider({
          driver: "claudeAgent",
          instanceId: "claudeAgent",
          status: "warning",
          models: [{ slug: "sonnet" }],
        }),
      ],
      expected: { instanceId: "claudeAgent", model: "sonnet" },
    },
    {
      name: "the driver default instance leads its custom instances",
      providers: [
        provider({ driver: "codex", instanceId: "codex_work", models: [{ slug: "work" }] }),
        provider({ driver: "codex", instanceId: "codex", models: [{ slug: "home" }] }),
      ],
      expected: { instanceId: "codex", model: "home" },
    },
    {
      name: "model order: default non-custom, first non-custom, first, driver fallback",
      providers: [
        provider({
          driver: "codex",
          instanceId: "codex",
          models: [
            { slug: "custom", isCustom: true },
            { slug: "plain" },
            { slug: "def", isDefault: true },
          ],
        }),
      ],
      expected: { instanceId: "codex", model: "def" },
    },
    {
      name: "first non-custom when none is marked default",
      providers: [
        provider({
          driver: "codex",
          instanceId: "codex",
          models: [{ slug: "custom", isCustom: true }, { slug: "plain" }],
        }),
      ],
      expected: { instanceId: "codex", model: "plain" },
    },
    {
      name: "first model when all are custom",
      providers: [
        provider({
          driver: "codex",
          instanceId: "codex",
          models: [{ slug: "custom", isCustom: true }],
        }),
      ],
      expected: { instanceId: "codex", model: "custom" },
    },
    {
      name: "driver fallback when the instance lists no models",
      providers: [provider({ driver: "codex", instanceId: "codex" })],
      expected: {
        instanceId: "codex",
        model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("codex")],
      },
    },
  ])("$name", ({ providers, expected }) => {
    expect(resolve(providers)).toEqual(
      expected && { ...expected, instanceId: ProviderInstanceId.make(expected.instanceId) },
    );
  });

  it("skips an instance the project turns off", () => {
    const projectId = ProjectId.make("project");
    const providers = [
      provider({ driver: "codex", instanceId: "codex", models: [{ slug: "a" }] }),
      provider({ driver: "claudeAgent", instanceId: "claudeAgent", models: [{ slug: "sonnet" }] }),
    ];
    expect(
      resolveProjectDefaultProviderModelSelection(
        providers,
        {
          providerInstances: {},
          projectSettingsOverrides: {
            [projectId]: {
              providerInstances: { [ProviderInstanceId.make("codex")]: { enabled: false } },
            },
          },
        },
        projectId,
      ),
    ).toEqual({ instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" });
  });
});
