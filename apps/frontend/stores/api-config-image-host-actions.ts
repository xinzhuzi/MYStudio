import { generateId } from "@/lib/api-key-manager";
import { normalizeImageHostProvider } from "./api-config-image-host";
import type { APIConfigStore } from "./api-config-store";

export type APIConfigImageHostActions = Pick<
  APIConfigStore,
  "addImageHostProvider" | "updateImageHostProvider" | "removeImageHostProvider"
>;

type SetAPIConfigState = (
  partial: Partial<APIConfigStore> | ((state: APIConfigStore) => Partial<APIConfigStore>),
) => void;
type GetAPIConfigState = () => APIConfigStore;

export function createAPIConfigImageHostActions(
  set: SetAPIConfigState,
  get: GetAPIConfigState,
): APIConfigImageHostActions {
  return {
    addImageHostProvider: (providerData) => {
      const newProvider = normalizeImageHostProvider({ ...providerData, id: generateId() });
      set((state) => ({
        imageHostProviders: [...state.imageHostProviders, newProvider],
      }));
      console.log(`[APIConfig] Added image host: ${newProvider.name}`);
      return newProvider;
    },

    updateImageHostProvider: (provider) => {
      const normalizedProvider = normalizeImageHostProvider(provider);
      set((state) => ({
        imageHostProviders: state.imageHostProviders.map((item) => (
          item.id === normalizedProvider.id ? normalizedProvider : item
        )),
      }));
      console.log(`[APIConfig] Updated image host: ${normalizedProvider.name}`);
    },

    removeImageHostProvider: (id) => {
      const provider = get().imageHostProviders.find((item) => item.id === id);
      set((state) => ({
        imageHostProviders: state.imageHostProviders.filter((item) => item.id !== id),
      }));
      if (provider) console.log(`[APIConfig] Removed image host: ${provider.name}`);
    },
  };
}
