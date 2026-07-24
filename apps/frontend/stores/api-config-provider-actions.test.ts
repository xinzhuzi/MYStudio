import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IProvider } from "@/lib/api-key-manager";
import type { APIConfigStore } from "./api-config-store-types";

const updateProviderKeys = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-key-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-key-manager")>();
  return { ...actual, updateProviderKeys };
});

import { createAPIConfigProviderActions } from "./api-config-provider-actions";

function provider(overrides: Partial<IProvider> = {}): IProvider {
  return {
    id: "provider-1",
    name: "供应商一",
    platform: "openai",
    apiKey: "key-1",
    baseUrl: "https://example.test/v1",
    model: ["model-1"],
    ...overrides,
  } as IProvider;
}

function setup() {
  let state = {
    providers: [provider()],
    providerAdapterCodes: [{ providerId: "provider-1", code: "", updatedAt: 1 }],
    featureBindings: { script_analysis: ["provider-1:model-1", "openai:model-2"] },
    agentDeployments: [{ key: "universalAi", vendorId: "provider-1", modelId: "provider-1:model-1" }],
    modelTypes: {},
    modelTags: {},
    modelEndpointTypes: {},
    modelEnableGroups: {},
  } as unknown as APIConfigStore;
  const set = (partial: Partial<APIConfigStore> | ((current: APIConfigStore) => Partial<APIConfigStore>)) => {
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) } as APIConfigStore;
  };
  const get = () => state;
  const actions = createAPIConfigProviderActions(set, get, {
    generateId: () => "provider-2",
    normalizeAgentDeployments: (deployments) => deployments,
  });
  state = { ...state, ...actions };
  return { actions, get };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAPIConfigProviderActions", () => {
  it("adds and updates providers while synchronizing the key manager", () => {
    const { actions, get } = setup();

    const added = actions.addProvider({
      ...provider({ id: "ignored", name: "供应商二", apiKey: "key-2" }),
    });
    actions.updateProvider({ ...added, apiKey: "key-2-updated" });

    expect(added.id).toBe("provider-2");
    expect(get().providers).toHaveLength(2);
    expect(get().providers.find((item) => item.id === "provider-2")?.apiKey).toBe("key-2-updated");
    expect(updateProviderKeys).toHaveBeenNthCalledWith(1, "provider-2", "key-2");
    expect(updateProviderKeys).toHaveBeenNthCalledWith(2, "provider-2", "key-2-updated");
  });

  it("removes provider-owned bindings, adapters, and deployment references", () => {
    const { actions, get } = setup();

    actions.removeProvider("provider-1");

    expect(get().providers).toEqual([]);
    expect(get().providerAdapterCodes).toEqual([]);
    expect(get().featureBindings.script_analysis).toBeNull();
    expect(get().agentDeployments[0]).toMatchObject({
      key: "universalAi",
      vendorId: undefined,
      modelId: undefined,
    });
  });
});
