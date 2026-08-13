import { generateId } from "@/lib/ai/core";
import { normalizeImageHostProvider } from "./api-config-image-host";
import type { APIConfigStore } from "./api-config-store-types";

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
  _get: GetAPIConfigState,
): APIConfigImageHostActions {
  return {
    addImageHostProvider: (providerData) => {
      const newProvider = normalizeImageHostProvider({ ...providerData, id: generateId() });
      set((state) => ({
        imageHostProviders: [...state.imageHostProviders, newProvider],
      }));
      return newProvider;
    },

    updateImageHostProvider: (provider) => {
      const normalizedProvider = normalizeImageHostProvider(provider);
      set((state) => ({
        imageHostProviders: state.imageHostProviders.map((item) => (
          item.id === normalizedProvider.id ? normalizedProvider : item
        )),
      }));
    },

    removeImageHostProvider: (id) => {
      set((state) => ({
        imageHostProviders: state.imageHostProviders.filter((item) => item.id !== id),
      }));
    },
  };
}
