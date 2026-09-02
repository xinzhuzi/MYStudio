// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageStudioProjectStorage } from "./image-studio-project-storage";
import { useProjectStore } from "@/stores/project/project-store";

/**
 * 09-03 画布分片式项目存储:<项目根>/store/image-studio/<canvasId>.json
 * + manifest.json(记录)。jsdom 用内存 map 模拟主进程 fileStorage 桥。
 */

const identity = (canvas: { id: string }) => canvas;
const initialProjectState = useProjectStore.getState();
const P = "_p/p1/image-studio";

function installFileStorageBridge(files: Map<string, string>) {
  const writes: string[] = [];
  const bridge = {
    getItem: vi.fn(async (key: string) => files.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      files.set(key, value);
      writes.push(key);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      files.delete(key);
      writes.push(key);
      return true;
    }),
    exists: vi.fn(async (key: string) => files.has(key)),
    listKeys: vi.fn(async (prefix: string) =>
      [...files.keys()].filter((key) => key.startsWith(`${prefix}/`)),
    ),
  };
  (window as unknown as { fileStorage: unknown }).fileStorage = bridge;
  return {
    writes,
    uninstall: () => delete (window as unknown as { fileStorage?: unknown }).fileStorage,
  };
}

function persisted(canvases: Array<Record<string, unknown>>, activeWorkflowId: string | null = null) {
  return JSON.stringify({ state: { workflows: canvases, activeWorkflowId, nodeExtras: {} }, version: 1 });
}

afterEach(() => {
  useProjectStore.setState(initialProjectState, true);
  localStorage.clear();
});

describe("image-studio 分片式项目存储(09-03)", () => {
  it("setItem 落一画布一分片+manifest 记录;getItem 组装还原", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>();
    const { uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    try {
      await storage.getItem("mystudio-image-studio");
      await storage.setItem(
        "mystudio-image-studio",
        persisted([
          { id: "studio-canvas-a", name: "主画布", updatedAt: 1, nodes: [], edges: [] },
          { id: "studio-canvas-b", name: "复原·0903", updatedAt: 2, nodes: [], edges: [] },
        ], "studio-canvas-a"),
      );
      // 一画布一文件 + manifest 记录(清单+激活)
      expect(files.has(`${P}/studio-canvas-a`)).toBe(true);
      expect(files.has(`${P}/studio-canvas-b`)).toBe(true);
      const manifest = JSON.parse(files.get(`${P}/manifest`)!);
      expect(manifest.canvases).toHaveLength(2);
      expect(manifest.canvases.map((entry: { name: string }) => entry.name)).toEqual(["主画布", "复原·0903"]);
      expect(manifest.activeWorkflowId).toBe("studio-canvas-a");

      const raw = await storage.getItem("mystudio-image-studio");
      const state = JSON.parse(raw!).state;
      expect(state.workflows).toHaveLength(2);
      expect(state.activeWorkflowId).toBe("studio-canvas-a");
    } finally {
      uninstall();
    }
  });

  it("增量写:只动变化的分片,manifest 内容不变不重写;删画布清理分片", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>();
    const { writes, uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    try {
      await storage.getItem("mystudio-image-studio");
      const canvasA = { id: "canvas-a", name: "A", updatedAt: 1, nodes: [] , edges: [] };
      const canvasB = { id: "canvas-b", name: "B", updatedAt: 1, nodes: [], edges: [] };
      await storage.setItem("mystudio-image-studio", persisted([canvasA, canvasB]));
      writes.length = 0;

      // 只改 A:A 分片重写;manifest 因记录 updatedAt 同步更新;B 分片不动
      const canvasA2 = { ...canvasA, updatedAt: 9 };
      await storage.setItem("mystudio-image-studio", persisted([canvasA2, canvasB]));
      expect(writes).toContain(`${P}/canvas-a`);
      expect(writes).toContain(`${P}/manifest`);
      expect(writes).not.toContain(`${P}/canvas-b`);

      // 完全无变化:零写入(空拖拽/无谓 setItem 不打磁盘)
      writes.length = 0;
      await storage.setItem("mystudio-image-studio", persisted([canvasA2, canvasB]));
      expect(writes).toEqual([]);

      // 删 B:其分片被清
      writes.length = 0;
      await storage.setItem("mystudio-image-studio", persisted([canvasA2]));
      expect(files.has(`${P}/canvas-b`)).toBe(false);
      expect(files.has(`${P}/canvas-a`)).toBe(true);
      expect(writes).toContain(`${P}/manifest`);
      expect(writes).toContain(`${P}/canvas-b`);
    } finally {
      uninstall();
    }
  });

  it("升级迁移:localStorage 旧账首读,下次写入落分片并退役旧键", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>();
    const { uninstall } = installFileStorageBridge(files);
    const legacy = persisted([{ id: "legacy-1", name: "旧画布", updatedAt: 1 }]);
    localStorage.setItem("mystudio-image-studio", legacy);
    const storage = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    try {
      const raw = await storage.getItem("mystudio-image-studio");
      expect(raw).toContain("旧画布");
      await storage.setItem("mystudio-image-studio", legacy);
      expect(files.has(`${P}/legacy-1`)).toBe(true);
      expect(JSON.parse(files.get(`${P}/manifest`)!).canvases[0].name).toBe("旧画布");
      expect(localStorage.getItem("mystudio-image-studio")).toBeNull();
      expect(files.has("mystudio-image-studio")).toBe(false);
    } finally {
      uninstall();
    }
  });

  it("manifest 丢失自愈:按幸存分片重建;新鲜项目空态", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>([
      [`${P}/canvas-x`, JSON.stringify({ id: "canvas-x", name: "孤儿", updatedAt: 5 })],
    ]);
    const { uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    try {
      const raw = await storage.getItem("mystudio-image-studio");
      expect(JSON.parse(raw!).state.workflows[0].name).toBe("孤儿");

      // 全新项目:分片/旧账俱无 → 空态(防上一项目渗血)
      useProjectStore.setState({ activeProjectId: "p2" });
      files.clear();
      const fresh = await storage.getItem("mystudio-image-studio");
      expect(JSON.parse(fresh!).state.workflows).toEqual([]);
    } finally {
      uninstall();
    }
  });

  it("预水合写守卫:首读前的 setItem 丢弃;无项目走 legacy", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>();
    const { uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    try {
      await storage.setItem("mystudio-image-studio", persisted([{ id: "premature" }]));
      expect(files.size).toBe(0);
      await storage.getItem("mystudio-image-studio");
      await storage.setItem("mystudio-image-studio", persisted([{ id: "after" }]));
      expect(files.has(`${P}/after`)).toBe(true);
    } finally {
      uninstall();
    }
    // 无项目:整体走 localStorage 旧行为(测试兼容)
    useProjectStore.setState({ activeProjectId: null });
    const storage2 = createImageStudioProjectStorage({ sanitizeWorkflow: identity });
    const raw = await storage2.getItem("mystudio-image-studio");
    expect(raw).toBeNull();
    await storage2.setItem("mystudio-image-studio", persisted([{ id: "noproj" }]));
    expect(localStorage.getItem("mystudio-image-studio")).toContain("noproj");
  });
});
