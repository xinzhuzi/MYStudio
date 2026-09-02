// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { StateStorage } from "zustand/middleware";
import { getActiveProjectId } from "./project-storage";
import { fileStorage } from "./indexed-db-storage";
import { useProjectStore } from "@/stores/project/project-store";

/**
 * 图片工作室画布的**分片式**项目侧持久化(09-03,用户裁定三轮收敛:
 * 画布是生产内容随项目走 + 多画布不得挤单文件 + 文件夹组织要有记录)。
 *
 * 磁盘形态(经 _p 虚拟键主进程重定向+store 布局白名单):
 *   <项目根>/store/image-studio/manifest.json   ← 记录:画布清单+激活+节点附加
 *   <项目根>/store/image-studio/<canvasId>.json ← 一画布一文件(ImageWorkflowGraph)
 * 道劫(外部位置=/Users/zhengbingjin/Project/IP/MA)即 IP/MA/store/image-studio/。
 * 分片文件与「导出画布 JSON」同构,导入导出天然配合;生成记录(ledger)仍在
 * 图旁 store/media/ai-image/,复原=新建画布=新分片文件,互不纠缠。
 *
 * 防护:预水合写守卫/新鲜项目空态/分片损坏跳过自愈/manifest 丢失按分片重建/
 * localStorage 旧账首读迁移(写入后退役)/瞬态媒体净化(调用方注入)。
 */

interface CanvasLike {
  id: string;
  name?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

interface Manifest {
  schemaVersion: 1;
  activeWorkflowId: string | null;
  /** 节点附加态(count 等),按 nodeId 键控——量小随 manifest 走 */
  nodeExtras: Record<string, unknown>;
  canvases: Array<{ id: string; name: string; updatedAt: number; shard: string }>;
}

export const IMAGE_STUDIO_STORE_NAME = "image-studio";

/** 分片文件名安全化:非法字符压缩,空则落 hash 兜底 */
function shardSlugFor(id: string, used: Set<string>): string {
  let base = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^[-]+|[-]+$/g, "") || "canvas";
  if (base.length > 64) base = base.slice(0, 64);
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
}

function parseOrNull(raw: string | null): unknown | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asCanvasList(value: unknown): CanvasLike[] {
  return Array.isArray(value)
    ? value.filter((item): item is CanvasLike => !!item && typeof item === "object" && typeof (item as CanvasLike).id === "string")
    : [];
}

function buildManifest(
  canvases: CanvasLike[],
  activeWorkflowId: string | null,
  nodeExtras: Record<string, unknown>,
): { manifest: Manifest; shardByCanvas: Map<string, string> } {
  const used = new Set<string>(["manifest"]);
  const shardByCanvas = new Map<string, string>();
  const entries = canvases.map((canvas) => {
    const shard = shardSlugFor(canvas.id, used);
    shardByCanvas.set(canvas.id, shard);
    return {
      id: canvas.id,
      name: typeof canvas.name === "string" ? canvas.name : "",
      updatedAt: typeof canvas.updatedAt === "number" ? canvas.updatedAt : 0,
      shard,
    };
  });
  return {
    manifest: { schemaVersion: 1, activeWorkflowId, nodeExtras, canvases: entries },
    shardByCanvas,
  };
}

function assemblePersisted(
  canvases: CanvasLike[],
  activeWorkflowId: string | null,
  nodeExtras: Record<string, unknown>,
): string {
  return JSON.stringify({
    state: { workflows: canvases, activeWorkflowId, nodeExtras },
    version: 1,
  });
}

function emptyPersistedState(): string {
  return assemblePersisted([], null, {});
}

/** window 桥扩展方法(StateStorage 适配器未暴露;Electron 在场,jsdom 测试可注入) */
function bridgeListKeys(prefix: string): Promise<string[]> {
  const bridge = (window as unknown as {
    fileStorage?: { listKeys?: (prefix: string) => Promise<string[]> };
  }).fileStorage;
  if (!bridge?.listKeys) return Promise.resolve([]);
  return bridge.listKeys(prefix).catch(() => [] as string[]);
}

function bridgeExists(key: string): Promise<boolean | null> {
  const bridge = (window as unknown as {
    fileStorage?: { exists?: (key: string) => Promise<boolean> };
  }).fileStorage;
  if (!bridge?.exists) return Promise.resolve(null);
  return bridge.exists(key).catch(() => null);
}

async function waitForProjectStoreHydration(): Promise<void> {
  if (useProjectStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = useProjectStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

export interface ImageStudioShardedStorageOptions {
  /** 持久化前净化单个画布(瞬态 data:/blob: 媒体禁入分片) */
  sanitizeWorkflow: (canvas: CanvasLike) => CanvasLike;
}

export function createImageStudioProjectStorage<T extends { id: string }>(
  options: { sanitizeWorkflow: (canvas: T) => T },
): StateStorage {
  const sanitizeWorkflow = options.sanitizeWorkflow as unknown as ImageStudioShardedStorageOptions["sanitizeWorkflow"];
  let hydratedOnce = false;
  /** legacy(localStorage 旧账)是否被消费过(服务或合并)——只有消费过才允许退役,
   * 防止 manifest 在场时把没读过的旧账直接删掉(09-03 退役时机事故根因) */
  let legacyConsumed = false;
  /** 旧账(localStorage 键+legacy 文件)只退修一次——首个成功项目写入后 */
  let legacyRetired = false;
  /** 上次落盘快照(增量写 diff 基线):canvasId→分片串 + manifest 串 */
  let lastWrittenCanvases = new Map<string, string>();
  let lastWrittenManifest = "";

  const prefixFor = (pid: string) => `_p/${pid}/${IMAGE_STUDIO_STORE_NAME}`;

  return {
    getItem: async (name: string): Promise<string | null> => {
      try {
        await waitForProjectStoreHydration();
        const pid = getActiveProjectId();
        if (!pid) {
          // 无项目(测试/极端态):沿用 legacy 数据,不迁移
          hydratedOnce = true;
          return localStorage.getItem(name);
        }
        const prefix = prefixFor(pid);
        const manifestParsed = parseOrNull(await fileStorage.getItem(`${prefix}/manifest`));
        if (manifestParsed && typeof manifestParsed === "object" && Array.isArray((manifestParsed as Manifest).canvases)) {
          const manifest = manifestParsed as Manifest;
          const canvases: CanvasLike[] = [];
          const used = new Set<string>(["manifest"]);
          for (const entry of manifest.canvases) {
            const shardParsed = parseOrNull(await fileStorage.getItem(`${prefix}/${entry.shard}`));
            if (shardParsed && typeof shardParsed === "object" && typeof (shardParsed as CanvasLike).id === "string") {
              shardSlugFor((shardParsed as CanvasLike).id, used); // 占位保持命名稳定
              canvases.push(shardParsed as CanvasLike);
            }
            // 分片缺失/损坏:跳过该画布(下次写入按幸存集重建 manifest)
          }
          hydratedOnce = true;
          const nodeExtras = manifest.nodeExtras && typeof manifest.nodeExtras === "object"
            ? manifest.nodeExtras
            : {};
          // 自愈(09-03 事故根因):manifest 在场时旧账若还在(localStorage 未被
          // 正常迁移),按 id 并入(冲突时 manifest 侧胜)——旧数据不搁浅,
          // 下次写入随全量落分片,随后退役才安全
          const legacyRaw = localStorage.getItem(name);
          if (legacyRaw !== null) {
            const legacyState = parseOrNull(legacyRaw) as
              | { state?: { workflows?: unknown } }
              | null;
            const present = new Set(canvases.map((canvas) => canvas.id));
            for (const legacyCanvas of asCanvasList(legacyState?.state?.workflows)) {
              if (!present.has(legacyCanvas.id)) canvases.push(legacyCanvas);
            }
            legacyConsumed = true;
          }
          return assemblePersisted(
            canvases,
            typeof manifest.activeWorkflowId === "string" ? manifest.activeWorkflowId : null,
            nodeExtras as Record<string, unknown>,
          );
        }
        // manifest 丢失但分片在场 → 按分片重建(自愈)
        const shardKeys = await bridgeListKeys(prefix);
        const orphanShards = shardKeys
          .map((key) => key.slice(prefix.length + 1))
          .filter((slug) => slug && slug !== "manifest" && !slug.endsWith("/"));
        if (orphanShards.length > 0) {
          const canvases: CanvasLike[] = [];
          for (const slug of orphanShards) {
            const shardParsed = parseOrNull(await fileStorage.getItem(`${prefix}/${slug}`));
            if (shardParsed && typeof shardParsed === "object" && typeof (shardParsed as CanvasLike).id === "string") {
              canvases.push(shardParsed as CanvasLike);
            }
          }
          if (canvases.length > 0) {
            hydratedOnce = true;
            return assemblePersisted(canvases, null, {});
          }
        }
        // localStorage 旧账(升级迁移):首读交给水合,下次写入落分片
        const legacy = localStorage.getItem(name);
        if (legacy !== null) {
          hydratedOnce = true;
          legacyConsumed = true;
          return legacy;
        }
        // 新鲜项目:manifest 确不存在 → 空态;存在但读失败 → null(保持内存态)
        const exists = await bridgeExists(`${prefix}/manifest`);
        hydratedOnce = true;
        return exists === false ? emptyPersistedState() : null;
      } catch {
        hydratedOnce = true;
        return null;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      if (!hydratedOnce) return;
      const pid = getActiveProjectId();
      if (!pid) {
        // 无项目:整体落 legacy(测试/极端态行为与旧版一致)
        localStorage.setItem(name, value);
        return;
      }
      const parsed = parseOrNull(value) as
        | { state?: { workflows?: unknown; activeWorkflowId?: unknown; nodeExtras?: unknown } }
        | null;
      const state = parsed?.state ?? {};
      const canvases = asCanvasList(state.workflows).map(sanitizeWorkflow);
      const activeWorkflowId =
        typeof state.activeWorkflowId === "string" ? state.activeWorkflowId : null;
      const nodeExtras =
        state.nodeExtras && typeof state.nodeExtras === "object"
          ? (state.nodeExtras as Record<string, unknown>)
          : {};
      const { manifest, shardByCanvas } = buildManifest(canvases, activeWorkflowId, nodeExtras);
      const manifestString = JSON.stringify(manifest, null, 2);

      const prefix = prefixFor(pid);
      // 增量写:只写变化/新增分片,删除已移除画布的分片;manifest 内容变才重写
      const next = new Map<string, string>();
      for (const canvas of canvases) {
        next.set(canvas.id, JSON.stringify(canvas, null, 2));
      }
      for (const [canvasId, shardString] of next) {
        if (lastWrittenCanvases.get(canvasId) !== shardString) {
          await fileStorage.setItem(`${prefix}/${shardByCanvas.get(canvasId)}`, shardString);
        }
      }
      for (const canvasId of lastWrittenCanvases.keys()) {
        if (!next.has(canvasId)) {
          await fileStorage.removeItem(`${prefix}/${shardSlugFor(canvasId, new Set(["manifest"]))}`);
        }
      }
      if (manifestString !== lastWrittenManifest) {
        await fileStorage.setItem(`${prefix}/manifest`, manifestString);
      }
      lastWrittenCanvases = next;
      lastWrittenManifest = manifestString;
      // 退役旧账只发生在「legacy 被消费过」(服务过或合并救回过)且尚未退修——
      // 没读过就删=丢数据(09-03 事故);未消费的旧账原地保留
      if (legacyConsumed && !legacyRetired) {
        localStorage.removeItem(name);
        await fileStorage.removeItem(name);
        legacyRetired = true;
      }
    },

    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      if (!pid) {
        localStorage.removeItem(name);
        return;
      }
      const prefix = prefixFor(pid);
      const manifestParsed = parseOrNull(await fileStorage.getItem(`${prefix}/manifest`));
      if (manifestParsed && typeof manifestParsed === "object" && Array.isArray((manifestParsed as Manifest).canvases)) {
        for (const entry of (manifestParsed as Manifest).canvases) {
          await fileStorage.removeItem(`${prefix}/${entry.shard}`);
        }
      }
      await fileStorage.removeItem(`${prefix}/manifest`);
      localStorage.removeItem(name);
      await fileStorage.removeItem(name);
      lastWrittenCanvases = new Map();
      lastWrittenManifest = "";
    },
  };
}
