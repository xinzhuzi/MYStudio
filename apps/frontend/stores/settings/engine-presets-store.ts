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

/** 设备级 SSH 凭据(11-03-device-level-ssh:设备=机器档案,照 ZCode ConnectionProfile
 * 每机一档;激活设备时整体落到 ssh-remote.json=当前生效机的解析结果)。 */
export interface EngineDeviceSsh {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  /** 每机令牌真源(可选;缺省=后端默认两条安装位路径)。 */
  tokenConfigPaths?: string[];
}

export interface EnginePreset {
  /** 归一半角 url;同时是去重键与 SelectItem value。 */
  url: string;
  /** 缺省=hostname(如 192.168.0.101:17000)。 */
  label: string;
  /** LRU 时间戳;数组序=展示序(新在前)。 */
  lastUsedAt: number;
  /** 设备级 SSH(11-03 多机:缺省=未配,激活时不改全局 SSH 配置)。 */
  ssh?: EngineDeviceSsh;
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
  /** 设备整档 upsert(1103 device-level-ssh:添加/编辑表单携 SSH 块)。 */
  saveDevice: (device: { url: string; label: string; ssh?: EngineDeviceSsh }) => boolean;
  /** 凭据回存进既有设备(SSH 设置区保存时回写当前生效设备;设备不存在=no-op)。 */
  attachSsh: (url: string, ssh: EngineDeviceSsh) => void;
}

export const useEnginePresetsStore = create<EnginePresetsState>()(
  persist(
    (set, get) => ({
      presets: [],
      favorite: (rawUrl, label) => {
        const url = normalizeEngineUrl(rawUrl);
        if (!/^https?:\/\//.test(url)) return false;
        const name = (label ?? "").trim();
        const existing = get().presets.find((p) => p.url === url);
        const rest = get().presets.filter((p) => p.url !== url);
        set({
          presets: [
            // 1103 device-level-ssh:自动收藏不得抹设备级 SSH 档(设备激活链会调本方法)
            { url, label: name || hostnameOf(url), lastUsedAt: Date.now(), ssh: existing?.ssh },
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
      saveDevice: (device) => {
        const url = normalizeEngineUrl(device.url);
        if (!/^https?:\/\//.test(url)) return false;
        const name = device.label.trim();
        const hit = get().presets.find((p) => p.url === url);
        // ssh=精确落值(undefined=明确解除设备级凭据;编辑表单「主机清空」靠此语义)
        const entry: EnginePreset = hit
          ? { ...hit, label: name || hostnameOf(url), ssh: device.ssh }
          : { url, label: name || hostnameOf(url), lastUsedAt: Date.now(), ssh: device.ssh };
        set({
          presets: [entry, ...get().presets.filter((p) => p.url !== url)].slice(0, ENGINE_PRESETS_MAX),
        });
        return true;
      },
      attachSsh: (url, ssh) =>
        set({
          presets: get().presets.map((p) => (p.url === url ? { ...p, ssh } : p)),
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
