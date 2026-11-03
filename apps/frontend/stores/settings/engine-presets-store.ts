// 引擎地址常用条目(11-02-engine-address-presets):预设属 UI 资产,localStorage 持久化
// (范式照抄 mcp-servers-store:0924 C1 safeStorage 加密落盘);后端 remote-engine.json
// 真源不动。「本机引擎」是纯 UI 常量伪条目(value="local"),不入库、不可删。
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  consumePendingPlaintextMigration,
  createSecureLocalStorage,
  getSecureVaultStatus,
} from "@/lib/storage/secure-local-storage";

export const ENGINE_PRESETS_STORAGE_KEY = "mystudio-engine-presets"; // 键名随 mystudio-mcp-servers 范式
export const ENGINE_PRESETS_MAX = 8;
export const LOCAL_ENGINE_PRESET_KEY = "local";

/** 全角 ：／→半角+trim+去尾斜杠(自 McpSettingsTab 迁入;合法 URL 不含全角件,归一无损)。 */
export function normalizeEngineUrl(raw: string): string {
  return raw.replace(/：/g, ":").replace(/／/g, "/").trim().replace(/\/+$/, "");
}

export interface EnginePreset {
  /** 归一半角 url;同时是去重键与 SelectItem value。 */
  url: string;
  /** 缺省=hostname(如 192.168.0.101:17000)。 */
  label: string;
  /** LRU 时间戳;数组序=展示序(新在前)。 */
  lastUsedAt: number;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface EnginePresetsState {
  presets: EnginePreset[];
  /** 入库(去重置顶/超限静默淘汰尾位 G4);非法格式返回 false 不入库(调用方给文案)。
   *  label 可选(1103 devices-list 役):空/缺省=hostname——设备自定义名由此入。 */
  favorite: (rawUrl: string, label?: string) => boolean;
  /** 保存/切换成功后刷新 LRU(置顶+时间戳)。 */
  touch: (url: string) => void;
  remove: (url: string) => void;
  /** 改设备名(保序保时间戳;1103 devices-list 编辑dialog 消费)。 */
  rename: (url: string, label: string) => void;
}

export const useEnginePresetsStore = create<EnginePresetsState>()(
  persist(
    (set, get) => ({
      presets: [],
      favorite: (rawUrl, label) => {
        const url = normalizeEngineUrl(rawUrl);
        if (!/^https?:\/\//.test(url)) return false;
        const name = (label ?? "").trim();
        const rest = get().presets.filter((p) => p.url !== url);
        set({
          presets: [
            { url, label: name || hostnameOf(url), lastUsedAt: Date.now() },
            ...rest,
          ].slice(0, ENGINE_PRESETS_MAX),
        });
        return true;
      },
      touch: (url) => {
        const hit = get().presets.find((p) => p.url === url);
        if (!hit) return;
        set({
          presets: [
            { ...hit, lastUsedAt: Date.now() },
            ...get().presets.filter((p) => p.url !== url),
          ],
        });
      },
      remove: (url) => set({ presets: get().presets.filter((p) => p.url !== url) }),
      rename: (url, label) =>
        set({
          presets: get().presets.map((p) =>
            p.url === url ? { ...p, label: label.trim() || hostnameOf(url) } : p,
          ),
        }),
    }),
    {
      name: ENGINE_PRESETS_STORAGE_KEY,
      partialize: (s) => ({ presets: s.presets }),
      // 0924 C1 同款:safeStorage 加密落盘;明文→密文迁移唯一写手=onRehydrateStorage
      storage: createJSONStorage(() => createSecureLocalStorage(ENGINE_PRESETS_STORAGE_KEY)),
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        if (getSecureVaultStatus(ENGINE_PRESETS_STORAGE_KEY).mode === "encrypted-unreadable") return;
        if (!consumePendingPlaintextMigration(ENGINE_PRESETS_STORAGE_KEY)) return;
        useEnginePresetsStore.setState({ presets: [...useEnginePresetsStore.getState().presets] });
      },
    },
  ),
);
