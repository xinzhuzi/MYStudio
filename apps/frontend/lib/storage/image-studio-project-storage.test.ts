// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageStudioProjectStorage } from "./image-studio-project-storage";
import { useProjectStore } from "@/stores/project/project-store";

/**
 * 09-03 画布落项目存储:storage 适配层三路语义。
 * jsdom 无 window.fileStorage 桥 → fileStorage 适配器回落 localStorage,
 * exists 探针返回 null(不可判)→ 新鲜项目走「保持内存态」分支;
 * 桥存在时用内存 map 模拟主进程行为。
 */

const identity = (raw: string) => raw;
const initialProjectState = useProjectStore.getState();

function installFileStorageBridge(files: Map<string, string>) {
  const bridge = {
    getItem: vi.fn(async (key: string) => files.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      files.set(key, value);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      files.delete(key);
      return true;
    }),
    exists: vi.fn(async (key: string) => files.has(key)),
  };
  (window as unknown as { fileStorage: unknown }).fileStorage = bridge;
  return { bridge, uninstall: () => delete (window as unknown as { fileStorage?: unknown }).fileStorage };
}

afterEach(() => {
  useProjectStore.setState(initialProjectState, true);
  localStorage.clear();
});

describe("image-studio 项目侧 storage(09-03)", () => {
  it("项目分片命中:直读项目键;写入净化后落分片并退役旧账", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map([["_p/p1/image-studio", '{"state":{"workflows":[{"id":"w1"}]}}']]);
    const { bridge, uninstall } = installFileStorageBridge(files);
    localStorage.setItem("mystudio-image-studio", '{"state":{"workflows":[]}}');
    const storage = createImageStudioProjectStorage(identity);
    try {
      const raw = await storage.getItem("mystudio-image-studio");
      expect(raw).toContain("w1");

      await storage.setItem("mystudio-image-studio", '{"state":{"workflows":[{"id":"w2"}]}}');
      expect(files.get("_p/p1/image-studio")).toContain("w2");
      // 旧账退役:localStorage 键与 legacy 文件键都不再有旧画布
      expect(localStorage.getItem("mystudio-image-studio")).toBeNull();
      expect(files.has("mystudio-image-studio")).toBe(false);
      expect(bridge.setItem).toHaveBeenCalledWith("_p/p1/image-studio", expect.any(String));
    } finally {
      uninstall();
    }
  });

  it("升级迁移:分片缺失+localStorage 旧账在 → 首读旧账,下次写入落分片", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map<string, string>();
    const { uninstall } = installFileStorageBridge(files);
    const legacy = '{"state":{"workflows":[{"id":"legacy-canvas"}]}}';
    localStorage.setItem("mystudio-image-studio", legacy);
    const storage = createImageStudioProjectStorage(identity);
    try {
      const raw = await storage.getItem("mystudio-image-studio");
      expect(raw).toContain("legacy-canvas");
      await storage.setItem("mystudio-image-studio", legacy);
      expect(files.get("_p/p1/image-studio")).toContain("legacy-canvas");
      expect(localStorage.getItem("mystudio-image-studio")).toBeNull();
    } finally {
      uninstall();
    }
  });

  it("新鲜项目:分片/旧账俱无 → 空态(防上一项目画布渗血)", async () => {
    useProjectStore.setState({ activeProjectId: "p2" });
    const files = new Map<string, string>();
    const { uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage(identity);
    try {
      const raw = await storage.getItem("mystudio-image-studio");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string).state.workflows).toEqual([]);
    } finally {
      uninstall();
    }
  });

  it("预水合写守卫:首读完成前的 setItem 被丢弃,不会覆盖分片", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    const files = new Map([["_p/p1/image-studio", '{"state":{"workflows":[{"id":"real"}]}}']]);
    const { uninstall } = installFileStorageBridge(files);
    const storage = createImageStudioProjectStorage(identity);
    try {
      await storage.setItem("mystudio-image-studio", '{"state":{"workflows":[{"id":"premature"}]}}');
      // 守卫生效:分片仍是 real,且 legacy 未被写脏
      expect(files.get("_p/p1/image-studio")).toContain("real");
      expect(localStorage.getItem("mystudio-image-studio")).toBeNull();
      // 首读后恢复写入
      await storage.getItem("mystudio-image-studio");
      await storage.setItem("mystudio-image-studio", '{"state":{"workflows":[{"id":"after"}]}}');
      expect(files.get("_p/p1/image-studio")).toContain("after");
    } finally {
      uninstall();
    }
  });
});
