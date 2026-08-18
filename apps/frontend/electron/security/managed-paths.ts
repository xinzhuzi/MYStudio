import { isPathInsideRoot } from "../storage/storage-paths";

/**
 * IPC 路径原语的受管根守卫。
 *
 * 渲染进程提供的绝对路径只有两类来源可信:
 * 1. 位于应用受管目录内(数据根/媒体根/userData/已注册项目位置等);
 * 2. 主进程原生对话框刚返回给渲染层的路径(短期「祝福」,TTL 内有效)。
 * 其余一律拒绝——防止被攻破的 renderer 把 fs/shell/ffprobe 当任意读写原语。
 */

export function isPathInsideAnyRoot(roots: readonly string[], target: string): boolean {
  return roots.some((root) => {
    try {
      return isPathInsideRoot(root, target);
    } catch {
      return false;
    }
  });
}

export type BlessedPathRegistry = {
  bless: (paths: readonly string[]) => void;
  has: (target: string) => boolean;
};

export function createBlessedPathRegistry(options?: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}): BlessedPathRegistry {
  const ttlMs = options?.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options?.maxEntries ?? 64;
  const now = options?.now ?? (() => Date.now());
  const entries = new Map<string, number>();

  const prune = (currentTime: number) => {
    for (const [path, blessedAt] of entries) {
      if (currentTime - blessedAt > ttlMs) entries.delete(path);
    }
  };

  return {
    bless(paths) {
      const currentTime = now();
      prune(currentTime);
      for (const target of paths) {
        if (typeof target !== "string" || !target.trim()) continue;
        entries.delete(target);
        entries.set(target, currentTime);
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      }
    },
    has(target) {
      const blessedAt = entries.get(target);
      if (blessedAt === undefined) return false;
      if (now() - blessedAt > ttlMs) {
        entries.delete(target);
        return false;
      }
      return true;
    },
  };
}
