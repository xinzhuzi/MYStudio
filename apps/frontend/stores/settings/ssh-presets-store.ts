// SSH 连接常用条目(11-03-device-level-ssh 终版:引擎地址与 SSH 连接=两个正交
// 维度,零联动)。多条 SSH 连接的真源在本前端 store;后端 ssh-remote.json 恒单份
// (=当前连接的解析结果),切换连接=把该条凭据 POST /comfy/ssh/config 落章
// (R4 后端零改)。落章回执里的 host+port+user 存为 activeFingerprint(1103
// ③修复:status 契约不回 port,指纹匹配的 port 侧事实只有这里记得住)。
// 存量迁移(Q2)不在 store 里做——组件挂载时 store 空+status
// 已配置 → 自动入列,见 McpSettingsTab。
// 主机/端口/用户/密钥路径属非敏感 UI 资产:明文 localStorage 即可(照
// workflow-bindings-store 范式,不引 safeStorage 加密链)。
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const SSH_PRESETS_STORAGE_KEY = "mystudio-ssh-presets"; // 键名随 mystudio-engine-presets 范式
export const SSH_PRESETS_MAX = 8;

export interface SshPreset {
  /** 去重键(uuid);编辑 dialog 保 id 改其余字段。 */
  id: string;
  /** 缺省=host(与引擎设备名缺省=hostname 同口径)。 */
  label: string;
  host: string;
  /** 默认 22。 */
  port: number;
  user: string;
  /** 留空=后端自动探测 ~/.ssh/id_ed25519 → id_ecdsa → id_rsa。 */
  keyPath: string;
  /** SSH 密码(可选;空=走密钥认证)。 */
  password: string;
  /** LRU 时间戳;数组序=展示序(新/最近用在前)。 */
  lastUsedAt: number;
}

/** save 入参:id/label/port/keyPath/lastUsedAt 可缺省(store 补齐),host 必填。 */
export interface SshPresetInput {
  id?: string;
  label?: string;
  host: string;
  port?: number;
  user?: string;
  keyPath?: string;
  password?: string;
  lastUsedAt?: number;
}

/** uuid 生成:现代运行时恒有 crypto.randomUUID;老环境兜底时间戳随机串(仅作去重键)。 */
function createPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ssh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 当前连接指纹(1103 ③修复:port 纳入)。GET /comfy/ssh/status 契约只回
 *  host/user(不回 port),而 PRD Q1/R2 的「当前连接」比对=host+port+user——
 *  port 侧真相取最近一次成功 POST /comfy/ssh/config 的回执(save_config 返回
 *  完整落盘配置,含 port),随 store 持久化跨重开存活。null=从未经 UI 落章
 *  (legacy/新装机),port 侧未知,匹配退回「唯一命中才认」(见
 *  McpSettingsTab.resolveActiveSshPresetId)。这不是第二份凭据真源(凭据仍
 *  恒以后端 ssh-remote.json 为准,本字段只承载 port 侧匹配事实)。 */
export interface SshActiveFingerprint {
  host: string;
  port: number;
  user: string;
}

interface SshPresetsState {
  presets: SshPreset[];
  /** 最近一次成功落章的配置指纹(POST /comfy/ssh/config 回执);null=未知。 */
  activeFingerprint: SshActiveFingerprint | null;
  /** 入库(按 id 去重置顶/超限静默淘汰尾位;host 空=非法返回 null 不入库,
   *  调用方给文案)。返回落库条目(添加流程需要拿到 id),非法返回 null。 */
  save: (preset: SshPresetInput) => SshPreset | null;
  remove: (id: string) => void;
  /** 切换成功后刷新 LRU(置顶+时间戳)。 */
  touch: (id: string) => void;
  /** 落章成功后记住当前连接指纹(1103 ③修复:回执携 port,匹配消歧用)。 */
  setActiveFingerprint: (fingerprint: SshActiveFingerprint) => void;
}

export const useSshPresetsStore = create<SshPresetsState>()(
  persist(
    (set, get) => ({
      presets: [],
      activeFingerprint: null,
      save: (input) => {
        const host = input.host.trim();
        if (!host) return null;
        const port =
          typeof input.port === "number" && Number.isFinite(input.port) && input.port > 0
            ? Math.floor(input.port)
            : 22;
        const id = input.id ?? createPresetId();
        const entry: SshPreset = {
          id,
          label: (input.label ?? "").trim() || host,
          host,
          port,
          user: (input.user ?? "").trim(),
          keyPath: (input.keyPath ?? "").trim(),
          password: (input.password ?? "").trim(),
          lastUsedAt: input.lastUsedAt ?? Date.now(),
        };
        set({
          presets: [entry, ...get().presets.filter((p) => p.id !== id)].slice(0, SSH_PRESETS_MAX),
        });
        return entry;
      },
      remove: (id) => set({ presets: get().presets.filter((p) => p.id !== id) }),
      touch: (id) => {
        const hit = get().presets.find((p) => p.id === id);
        if (!hit) return;
        set({
          presets: [
            { ...hit, lastUsedAt: Date.now() },
            ...get().presets.filter((p) => p.id !== id),
          ],
        });
      },
      setActiveFingerprint: (fingerprint) => set({ activeFingerprint: fingerprint }),
    }),
    {
      name: SSH_PRESETS_STORAGE_KEY,
      partialize: (s) => ({ presets: s.presets, activeFingerprint: s.activeFingerprint }),
      // 凭据路径/主机名非敏感(Q2 裁定明文);引擎条目走 safeStorage 是因同键
      // 范式共链,此 store 无密件不引加密链
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
