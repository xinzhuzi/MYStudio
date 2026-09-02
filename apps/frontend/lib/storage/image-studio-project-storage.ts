// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { StateStorage } from "zustand/middleware";
import { createProjectScopedStorage, getActiveProjectId } from "./project-storage";
import { fileStorage } from "./indexed-db-storage";

/**
 * 图片工作室画布的项目侧持久化(09-03 用户裁定:画布是生产内容,
 * 必须随项目走,不住应用级 Chromium localStorage)。
 *
 * 数据落 `_p/<activeProjectId>/image-studio.json`(经 fileStorage IPC,
 * 与 director/tts 等项目 store 同位、同路由规则)。四层防护:
 *
 * 1. **旧账迁移**:scoped.getItem 的回退链(Electron 下 fileStorage 适配器
 *    会把 localStorage/IndexedDB 旧账迁为 legacy 文件键)负责首读;写入
 *    项目分片成功后把 localStorage 键与 legacy 文件一并退役,防止新项目
 *    通过 legacy 回退继续吸到旧画布。
 * 2. **预水合写守卫**:首读完成前 setItem 一律丢弃——挂载期的
 *    ensureDefaultWorkflow 若抢在水合前触发,会把默认空画布写进项目
 *    分片覆盖真实数据。
 * 3. **新鲜项目空态**:有项目、分片与旧账俱无 → 返回空态 JSON,
 *    防止上一项目的画布渗血进新项目(rehydrate 置空);分片在而读失败
 *    → null(保持内存态不清场)。
 * 4. **瞬态媒体净化**:调用方注入 sanitize(data:/blob: URL 禁入持久化)。
 */

export const IMAGE_STUDIO_STORE_NAME = "image-studio";

/** 新鲜项目的空态(zustand persist 反序列化形状) */
function emptyPersistedState(): string {
  return JSON.stringify({
    state: { workflows: [], activeWorkflowId: null, nodeExtras: {} },
    version: 1,
  });
}

/** 主进程 fileStorage 桥的 exists 探针(渲染层 StateStorage 适配器无此方法) */
async function projectShardExists(projectKey: string): Promise<boolean | null> {
  const bridge = (window as unknown as {
    fileStorage?: { exists?: (key: string) => Promise<boolean> };
  }).fileStorage;
  if (!bridge?.exists) return null;
  try {
    return await bridge.exists(projectKey);
  } catch {
    return null;
  }
}

export function createImageStudioProjectStorage(
  sanitize: (raw: string) => string,
): StateStorage {
  const scoped = createProjectScopedStorage(IMAGE_STUDIO_STORE_NAME);
  let hydratedOnce = false;

  return {
    getItem: async (name: string): Promise<string | null> => {
      try {
        const raw = await scoped.getItem(name);
        if (raw !== null) {
          hydratedOnce = true;
          return raw;
        }
        const pid = getActiveProjectId();
        if (!pid) {
          // 无项目(测试/极端态):沿用 legacy 数据,不迁移
          hydratedOnce = true;
          return localStorage.getItem(name);
        }
        // 兜底:scoped 回退链未覆盖到的 localStorage 直读
        const legacy = localStorage.getItem(name);
        if (legacy !== null) {
          hydratedOnce = true;
          return legacy;
        }
        // 新鲜项目:分片确不存在 → 空态;存在但读失败 → null(保持内存态)
        const exists = await projectShardExists(`_p/${pid}/${IMAGE_STUDIO_STORE_NAME}`);
        hydratedOnce = true;
        return exists === false ? emptyPersistedState() : null;
      } catch {
        // 读链整体异常:保持内存态,不让水合清场
        hydratedOnce = true;
        return null;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      if (!hydratedOnce) return;
      const hadProject = getActiveProjectId() !== null;
      await scoped.setItem(name, sanitize(value));
      if (hadProject) {
        // 写入已落项目分片:退役旧账(localStorage 键+legacy 文件),
        // 防止无分片的新项目经 legacy 回退吸到这批画布
        localStorage.removeItem(name);
        await fileStorage.removeItem(name);
      }
    },

    removeItem: async (name: string): Promise<void> => {
      await scoped.removeItem(name);
      localStorage.removeItem(name);
      await fileStorage.removeItem(name);
    },
  };
}
