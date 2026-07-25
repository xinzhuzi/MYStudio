import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIConfigStore } from "./api-config-store-types";
import type { ImageHostProvider } from "./api-config-image-host";
import { createAPIConfigImageHostActions } from "./api-config-image-host-actions";

const providerInput: Omit<ImageHostProvider, "id"> = {
  platform: "custom",
  name: "Custom Host",
  baseUrl: "https://images.example.test",
  uploadPath: "/upload",
  apiKey: "key",
  enabled: true,
};

describe("API config image host actions", () => {
  let state: APIConfigStore;
  const setState = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    state = { imageHostProviders: [] } as unknown as APIConfigStore;
    setState.mockImplementation((partial: Partial<APIConfigStore> | ((value: APIConfigStore) => Partial<APIConfigStore>)) => {
      const update = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...update };
    });
  });

  it("normalizes and adds providers with generated ids", () => {
    const actions = createAPIConfigImageHostActions(setState, () => state);
    const added = actions.addImageHostProvider(providerInput);

    expect(added.id).toEqual(expect.any(String));
    expect(state.imageHostProviders).toEqual([added]);
  });

  it("normalizes updates and removes only the requested provider", () => {
    const actions = createAPIConfigImageHostActions(setState, () => state);
    const first = actions.addImageHostProvider(providerInput);
    const second = actions.addImageHostProvider({ ...providerInput, name: "Second Host" });

    actions.updateImageHostProvider({ ...first, name: "Updated Host" });
    expect(state.imageHostProviders.find((item) => item.id === first.id)?.name).toBe("Updated Host");

    actions.removeImageHostProvider(first.id);
    expect(state.imageHostProviders).toEqual([second]);
  });
});
