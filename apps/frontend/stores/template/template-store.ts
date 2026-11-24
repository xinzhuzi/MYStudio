/**
 * B5 推广模板 zustand store——渲染进程缓存模板列表,与主进程 SQLite 同步。
 * 不绑项目 scope(模板跟随产品,产品是顶层实体)。
 */
import { create } from "zustand";
import type { PromotionTemplate } from "@/types/promotion-template";

function getTemplateBridge() {
  return typeof window === "undefined" ? undefined : window.templateBridge;
}

export interface TemplateStore {
  templates: PromotionTemplate[];
  loading: boolean;
  setTemplates: (templates: PromotionTemplate[]) => void;
  upsertTemplate: (template: PromotionTemplate) => void;
  removeTemplate: (id: string) => void;
  removeTemplatesByProduct: (productId: string) => void;
  setLoading: (loading: boolean) => void;
  loadTemplates: () => Promise<void>;
  saveTemplate: (template: PromotionTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  loading: false,

  setTemplates: (templates) => set({ templates }),

  upsertTemplate: (template) => set((state) => ({
    templates: [
      ...state.templates.filter((t) => t.id !== template.id),
      template,
    ],
  })),

  removeTemplate: (id) => set((state) => ({
    templates: state.templates.filter((t) => t.id !== id),
  })),

  removeTemplatesByProduct: (productId) => set((state) => ({
    templates: state.templates.filter((t) => t.productId !== productId),
  })),

  setLoading: (loading) => set({ loading }),

  loadTemplates: async () => {
    const bridge = getTemplateBridge();
    if (!bridge) return;
    set({ loading: true });
    try {
      const reply = await bridge.list();
      if (reply.success) {
        set({ templates: reply.value });
      }
    } finally {
      set({ loading: false });
    }
  },

  saveTemplate: async (template) => {
    const bridge = getTemplateBridge();
    if (!bridge) return;
    const reply = await bridge.upsert({ template });
    if (reply.success) {
      get().upsertTemplate(reply.value);
    }
  },

  deleteTemplate: async (id) => {
    const bridge = getTemplateBridge();
    if (!bridge) return;
    const reply = await bridge.delete({ id });
    if (reply.success) {
      get().removeTemplate(id);
    }
  },
}));
