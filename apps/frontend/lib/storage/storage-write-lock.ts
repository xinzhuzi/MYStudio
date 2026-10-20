/**
 * 项目级存储写锁(10-20 D41,事件档后续事项#2):跨实例(装机 App/dev 实例/
 * 其他 bundle)互斥写同一项目的 studio-workflow 分片库。
 *
 * 背景:今天三起数据事故的共同催化剂=多实例交错写(两个进程各自的内存代缓存
 * 互不知情,manifest 最后写者赢=静默吃对方的分片名,孤儿清理随后整目录回收)。
 * runner 侧 ownerPid+heartbeat 只护执行器不护存储——本锁补存储层。
 *
 * 语义(租约式):
 * - 锁文件=项目数据根 `store/.storage-write-lock.json`(studio-workflow 之外,
 *   不入孤儿清理辖区;跨 bundle 可见——projectFiles 桥落在真实项目目录)。
 * - 内容={id, ts}:id=本实例随机令牌,ts=心跳时刻(epoch ms)。
 * - 获取:文件缺席/已释放/陈旧(>staleMs)→ 写入我方;写入后**回读验主**防双
 *   接管竞速(两实例同见陈旧同写,回读见非我方 id 的新鲜锁=输家拒写)。
 * - 心跳:持有后 setInterval(beatMs) 刷 ts;空闲 App 也不会让锁假死被他人接管。
 * - 释放:window beforeunload 尽力 deleteText(善退即删,重开零等待);硬杀/
 *   崩溃由 staleMs 兜底(重开最坏等 staleMs 拒写窗)。
 * - 桥缺席(单测/无桥环境)=不启用锁(fail-open 存旧行为):锁是并行互斥保险,
 *   不是单实例自身的前置条件。
 *
 * 集成点:storage-project-sharded.ts setItem 顶部「持锁才写」(拒写 fail-closed,
 * 与水合竞态守卫同款);读路径(getItem)零拦截——只读实例无害。
 */

/** 桥的最小面(结构性子集,与 Window["projectFiles"] 兼容) */
/**
 * 生产 projectFiles 桥面(真项目根三件套,preload.ts:97 实测):
 * - readText({projectId,relativePath}) 读真项目根 ✓
 * - writeText(key,value) 位置参写的是 App 影子目录(~/Library/.../projects/)——
 *   跨实例不可见,禁用于锁(10-20 D41 实弹勘误)
 * - writeBinary({projectId,relativePath,bytes}) 写真项目根 ✓(探针实证 IP/MA)
 * - deleteFile({projectId,relativePath}) 删真项目根 ✓
 */
export interface StorageLockBridge {
  readText: (payload: { projectId: string; relativePath: string }) => Promise<{ success?: boolean; text?: string; error?: string } | null>;
  writeBinary: (payload: { projectId: string; relativePath: string; bytes: Uint8Array }) => Promise<{ success?: boolean; error?: string } | unknown>;
  deleteFile?: (payload: { projectId: string; relativePath: string }) => Promise<{ success?: boolean; error?: string } | unknown>;
}

export interface StorageWriteLockOptions {
  /** 心跳间隔 ms(默认 5000) */
  beatMs?: number;
  /** 陈旧阈值 ms(默认 15000;须显著大于 beatMs) */
  staleMs?: number;
  /** 时钟注入(测试确定性) */
  now?: () => number;
}

interface LockFileShape {
  id?: string;
  ts?: number;
}

export interface WriteLockVerdict {
  ok: boolean;
  /** 拒写时的原因(取证/日志用) */
  reason?: string;
}

const LOCK_RELATIVE_PATH = "store/.storage-write-lock.json";

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface HeldLock {
  id: string;
  timer: ReturnType<typeof setInterval>;
  lastBeat: number;
}

/**
 * 每项目一把写锁。工厂返回 ensure/release;同进程多项目各自持锁互不干扰
 * (Map 键=调用方给的项目键,锁文件路径恒一——同项目根即同一把)。
 */
export function createStorageWriteLock(
  getBridge: () => StorageLockBridge | undefined,
  options: StorageWriteLockOptions = {},
) {
  const beatMs = options.beatMs ?? 5000;
  const staleMs = options.staleMs ?? 15000;
  const now = options.now ?? Date.now;
  const held = new Map<string, HeldLock>();
  const unloaded = new Set<() => void>();

  async function readLockFile(bridge: StorageLockBridge, projectId: string): Promise<LockFileShape | null> {
    try {
      const res = await bridge.readText({ projectId, relativePath: LOCK_RELATIVE_PATH });
      if (!res || res.success === false || typeof res.text !== "string") return null;
      const parsed = JSON.parse(res.text) as LockFileShape;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async function writeLockFile(bridge: StorageLockBridge, id: string, projectId: string): Promise<boolean> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ id, ts: now() }));
      const res = await bridge.writeBinary({ projectId, relativePath: LOCK_RELATIVE_PATH, bytes });
      return !res || (res as { success?: boolean }).success !== false;
    } catch {
      return false;
    }
  }

  function startHeartbeat(id: string, bridge: StorageLockBridge, projectId: string): HeldLock["timer"] {
    // 全局 setInterval(测试桥会整体替换 window 为裸对象,window.* 不可靠)
    const timer = setInterval(() => {
      void writeLockFile(bridge, id, projectId);
    }, beatMs);
    return timer;
  }

  function ensureUnloadRelease(bridge: StorageLockBridge): void {
    if (unloaded.size > 0 || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const handler = () => {
      // 善退尽力:删除锁文件(失败则由 staleMs 兜底)
      for (const [key, lock] of held) {
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({ id: lock.id, ts: 0 }));
          if (bridge.deleteFile) void bridge.deleteFile({ projectId: key, relativePath: LOCK_RELATIVE_PATH });
          else void bridge.writeBinary({ projectId: key, relativePath: LOCK_RELATIVE_PATH, bytes });
        } catch {
          // 尽力而为,不阻塞卸载
        }
      }
    };
    window.addEventListener("beforeunload", handler);
    unloaded.add(() => {
      if (typeof window.removeEventListener === "function") window.removeEventListener("beforeunload", handler);
    });
  }

  return {
    /** 测试隔离钩子:释放全部持锁(生产勿用) */
    async releaseAll(): Promise<void> {
      for (const key of [...held.keys()]) await this.release(key);
    },

    /** setItem 守卫入口:持锁(或成功取锁)→ ok:true;他人新鲜持锁→ ok:false */
    async ensure(projectKey: string): Promise<WriteLockVerdict> {
      const bridge = getBridge();
      if (!bridge) return { ok: true, reason: "no-bridge(fail-open)" };
      const mine = held.get(projectKey);
      if (mine) {
        // 已持:超过一个心跳窗未刷则补刷(定时器之外的兜底)
        if (now() - mine.lastBeat >= beatMs) {
          await writeLockFile(bridge, mine.id, projectKey);
          mine.lastBeat = now();
        }
        return { ok: true };
      }
      const existing = await readLockFile(bridge, projectKey);
      const foreign =
        existing && typeof existing.id === "string" && existing.id.length > 0 && existing.id !== "";
      if (foreign && typeof existing?.ts === "number" && existing.ts > 0 && now() - existing.ts < staleMs) {
        return {
          ok: false,
          reason: `锁被实例 ${String(existing.id).slice(0, 8)}… 持有(ts ${Math.round((now() - (existing.ts ?? 0)) / 1000)}s 前);本实例拒写防互踩`,
        };
      }
      // 缺席/已释放/陈旧 → 取锁(写入我方即持有;写入失败=拒写)
      // 注:不做写后回读验主——双接管竞速(两例同瞬间接管同一陈旧锁)留作
      // 已知窄窗,主防护=新鲜锁拒写;读写均已走真项目根 writeBinary/readText。
      const id = randomToken();
      if (!(await writeLockFile(bridge, id, projectKey))) {
        return { ok: false, reason: "锁文件写入失败(桥异常);拒写" };
      }
      const timer = startHeartbeat(id, bridge, projectKey);
      held.set(projectKey, { id, timer, lastBeat: now() });
      ensureUnloadRelease(bridge);
      return { ok: true };
    },

    /** 释放(测试/显式下线用);生产善退走 beforeunload */
    async release(projectKey: string): Promise<void> {
      const bridge = getBridge();
      const mine = held.get(projectKey);
      if (!mine) return;
      clearInterval(mine.timer);
      held.delete(projectKey);
      const releasePayload = { projectId: projectKey, relativePath: LOCK_RELATIVE_PATH };
      try {
        if (bridge?.deleteFile) {
          const res = await bridge.deleteFile(releasePayload);
          if (!res || (res as { success?: boolean }).success === false) {
            // 删除失败退而标记释放(ts=0=任何实例可立即取)
            await bridge.writeBinary({ ...releasePayload, bytes: new TextEncoder().encode(JSON.stringify({ id: mine.id, ts: 0 })) });
          }
          return;
        }
      } catch {
        // fallthrough 到标记释放
      }
      if (bridge) {
        try {
          await bridge.writeBinary({ ...releasePayload, bytes: new TextEncoder().encode(JSON.stringify({ id: mine.id, ts: 0 })) });
        } catch {
          // 尽力而为;staleMs 兜底
        }
      }
    },
  };
}

export type StorageWriteLock = ReturnType<typeof createStorageWriteLock>;
