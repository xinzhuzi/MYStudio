// 展示页配置 store(A9/A10 补检条目)。品牌名/标语/邮箱/社媒链接原先住在
// ShowcaseView 的组件 state 里,面板随页签卸载(Layout.tsx),切走再回来全部丢失;
// 落 zustand persist 后配置跨页签存活。范式照 stores/settings/workflow-bindings-store.ts:
// 非敏感 UI 资产,明文 localStorage,不引加密链。
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const SHOWCASE_CONFIG_STORAGE_KEY = "mystudio-self-media-showcase-config";

export interface ShowcaseSocialLink {
  platform: string;
  url: string;
}

export interface ShowcaseConfig {
  brandName: string;
  brandTagline: string;
  contactEmail: string;
  socialLinks: ShowcaseSocialLink[];
}

export const DEFAULT_SHOWCASE_CONFIG: ShowcaseConfig = {
  brandName: "MYStudio",
  brandTagline: "创意工作室 · 数字产品集合",
  contactEmail: "",
  socialLinks: [],
};

interface ShowcaseConfigState extends ShowcaseConfig {
  /** 品牌名/标语/邮箱等标量字段的补丁式更新。 */
  patchConfig: (patch: Partial<ShowcaseConfig>) => void;
  /** 社媒链接末尾追加一行空行(A10)。 */
  addSocialLink: () => void;
  updateSocialLink: (index: number, patch: Partial<ShowcaseSocialLink>) => void;
  removeSocialLink: (index: number) => void;
}

export const useShowcaseConfigStore = create<ShowcaseConfigState>()(
  persist(
    (set) => ({
      ...DEFAULT_SHOWCASE_CONFIG,
      patchConfig: (patch) => set(patch),
      addSocialLink: () =>
        set((state) => ({ socialLinks: [...state.socialLinks, { platform: "", url: "" }] })),
      updateSocialLink: (index, patch) =>
        set((state) => ({
          socialLinks: state.socialLinks.map((link, i) =>
            i === index ? { ...link, ...patch } : link,
          ),
        })),
      removeSocialLink: (index) =>
        set((state) => ({ socialLinks: state.socialLinks.filter((_, i) => i !== index) })),
    }),
    {
      name: SHOWCASE_CONFIG_STORAGE_KEY,
      // 只持久化数据字段;动作函数不进 localStorage
      partialize: (state) => ({
        brandName: state.brandName,
        brandTagline: state.brandTagline,
        contactEmail: state.contactEmail,
        socialLinks: state.socialLinks,
      }),
      // 工作流绑定 store 同款注释:此 store 无密件,明文 localStorage 即可
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
