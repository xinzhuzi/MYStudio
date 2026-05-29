import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";
import { validateVendorConfig } from "@/lib/studio/model-config";
import type { ModelBinding, VendorConfig } from "@/types/studio";

interface StudioConfigState {
  vendors: VendorConfig[];
  bindings: ModelBinding[];
  lastValidationMessage: string | null;
}

interface StudioConfigActions {
  upsertVendor: (vendor: VendorConfig) => void;
  removeVendor: (id: string) => void;
  setBinding: (binding: ModelBinding) => void;
  validateConfig: () => { ok: boolean; message: string };
  resetStudioConfig: () => void;
}

type StudioConfigStore = StudioConfigState & StudioConfigActions;

const defaultVendor: VendorConfig = {
  id: "openai-compatible-relay",
  name: "OpenAI 兼容中转站",
  enabled: false,
  relayBaseUrl: "",
  inputValues: { apiKey: "" },
  models: [
    {
      id: "openai-compatible-relay:text",
      name: "文本模型占位",
      type: "text",
      capabilities: {},
      defaultParams: { temperature: 0.7 },
    },
    {
      id: "openai-compatible-relay:video",
      name: "视频模型占位",
      type: "video",
      capabilities: { imageReference: 1, audioReference: 1, durations: [5, 10], resolutions: ["720p", "1080p"] },
      defaultParams: { resolution: "1080p" },
    },
  ],
};

const initialState: StudioConfigState = {
  vendors: [defaultVendor],
  bindings: [
    { key: "scriptAgent", modelId: "openai-compatible-relay:text" },
    { key: "storySkeletonAgent", modelId: "openai-compatible-relay:text" },
    { key: "adaptationStrategyAgent", modelId: "openai-compatible-relay:text" },
    { key: "storyboardImage", modelId: "openai-compatible-relay:video" },
    { key: "videoTrack", modelId: "openai-compatible-relay:video" },
    { key: "tts", modelId: "openai-compatible-relay:text" },
    { key: "universalAi", modelId: "openai-compatible-relay:text" },
  ],
  lastValidationMessage: null,
};

export const useStudioConfigStore = create<StudioConfigStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      upsertVendor: (vendor) => {
        const validated = validateVendorConfig(vendor);
        set((state) => ({
          vendors: state.vendors.some((item) => item.id === validated.id)
            ? state.vendors.map((item) => (item.id === validated.id ? validated : item))
            : [...state.vendors, validated],
          lastValidationMessage: "配置已保存",
        }));
      },

      removeVendor: (id) => {
        set((state) => ({
          vendors: state.vendors.filter((item) => item.id !== id),
          bindings: state.bindings.filter((binding) => !binding.modelId.startsWith(`${id}:`)),
        }));
      },

      setBinding: (binding) => {
        set((state) => ({
          bindings: state.bindings.some((item) => item.key === binding.key)
            ? state.bindings.map((item) => (item.key === binding.key ? binding : item))
            : [...state.bindings, binding],
        }));
      },

      validateConfig: () => {
        try {
          get().vendors.forEach(validateVendorConfig);
          const result = { ok: true, message: "配置格式有效，V1 不会执行模型请求" };
          set({ lastValidationMessage: result.message });
          return result;
        } catch (error) {
          const result = { ok: false, message: error instanceof Error ? error.message : "配置格式无效" };
          set({ lastValidationMessage: result.message });
          return result;
        }
      },

      resetStudioConfig: () => set({ ...initialState }),
    }),
    {
      name: "studio-config-store",
      storage: createJSONStorage(() => fileStorage),
      version: 1,
    },
  ),
);
