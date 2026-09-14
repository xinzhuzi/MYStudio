// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
  storyboards: [] as unknown[],
  // 09-11 链工作流保鲜:指纹与环节摘要消费的环节计数(mock 照真 store 形状)
  novelChapters: [] as unknown[],
  scriptPlans: [] as unknown[],
  entityExtractions: [] as unknown[],
  productionTracks: [] as unknown[],
}));

vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => storeState },
}));

// jsdom 不解码图片,真缩略管线会挂起——mock 成透传 data URL
vi.mock("@/lib/ai/image-transfer", () => ({
  prepareReferenceImageForTransfer: async (source: string) =>
    source.startsWith("data:") ? source : `data:image/jpeg;base64,${source}`,
}));

import {
  ensureStageAssetCoversUploaded,
  invalidateOverviewSyncForEngineStart,
  resetOverviewSyncForTests,
  syncStoryboardOverviewToLibrary,
} from "@/lib/assist/image-studio/storyboard-overview-sync";
import type { StageNodePayload } from "@/lib/assist/image-studio/storyboard-pipeline-comfy";
import type { StoryboardItem } from "@/types/studio";

function shot(id: string, index: number, mediaRef?: { kind: string; path: string }): StoryboardItem {
  return { id, episodeId: "chapter-001", index, duration: 2, videoDesc: `第${index}镜`, mediaRef } as unknown as StoryboardItem;
}

function makeDeps() {
  const imported: Array<{ name: string; mode: unknown }> = [];
  const uploads: Array<{ name: string; b64: string }> = [];
  const deps = {
    readImageB64: async (url: string) => (url ? "cmF3" : null),
    uploadPreview: async (name: string, b64: string) => {
      uploads.push({ name, b64 });
      return true;
    },
  };
  const transport = {
    importFiles: async (files: Array<{ name: string; content: string }>, mode: unknown) => {
      imported.push(...files.map((file) => ({ name: file.name, mode })));
      // status 用 as const 对齐联合类型(renamed 变体才要 renamedTo)
      return files.map((file) => ({ name: file.name, status: "imported" as const, id: `id-${file.name}` }));
    },
  };
  return { deps, transport, imported, uploads };
}

describe("syncStoryboardOverviewToLibrary(09-10 批9:图片带)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOverviewSyncForTests();
    storeState.storyboards = [];
  });

  it("带图镜先传缩略(my-shot-*.jpg)再导入 分镜/0_工作流主线/;无图镜零上传", async () => {
    storeState.storyboards = [
      shot("S01-01", 1, { kind: "image", path: "project-file://a.png" }),
      shot("S01-02", 2),
    ];
    const { deps, transport, imported, uploads } = makeDeps();

    await expect(syncStoryboardOverviewToLibrary({ ...deps, transport })).resolves.toBe(true);

    expect(uploads).toEqual([{ name: "my-shot-S01-01.jpg", b64: "cmF3" }]);
    expect(imported).toHaveLength(1);
    // 双帧(09-14):帧2 存在时加传 my-shot-<id>-k2.jpg
    storeState.storyboards = [
      {
        ...shot("S01-01", 1, { kind: "image", path: "project-file://a.png" }),
        keyframes: [
          { mediaRef: { kind: "image", path: "project-file://a.png" } },
          { mediaRef: { kind: "image", path: "project-file://b.png" } },
        ],
      } as unknown as StoryboardItem,
    ];
    resetOverviewSyncForTests();
    const dualDeps = makeDeps();
    await expect(syncStoryboardOverviewToLibrary({ ...dualDeps.deps, transport: dualDeps.transport })).resolves.toBe(true);
    expect(dualDeps.uploads.map((u) => u.name)).toEqual([
      "my-shot-S01-01.jpg",
      "my-shot-S01-01-k2.jpg",
    ]);
    // 09-11 旧画布迁移:保鲜产物=分镜流程链工作流,落位 0_工作流主线
    expect(imported[0].name).toBe("分镜/0_工作流主线/MY-分镜工作流.json");
    expect(imported[0].mode).toBe("overwrite");
  });

  it("读图失败不阻断导入(该镜退化为文字卡);指纹守卫=同指纹第二次零动作", async () => {
    storeState.storyboards = [shot("S01-01", 1, { kind: "image", path: "project-file://a.png" })];
    const first = makeDeps();
    first.deps.readImageB64 = async () => null; // 读图失败
    await expect(syncStoryboardOverviewToLibrary({ ...first.deps, transport: first.transport })).resolves.toBe(true);
    expect(first.uploads).toHaveLength(0);
    expect(first.imported).toHaveLength(1);

    const second = makeDeps();
    await expect(syncStoryboardOverviewToLibrary({ ...second.deps, transport: second.transport })).resolves.toBe(true);
    expect(second.imported).toHaveLength(0); // 指纹未变,不再导入
  });

  it("空分镜表直接短路", async () => {
    const { transport, imported } = makeDeps();
    await expect(syncStoryboardOverviewToLibrary({ transport })).resolves.toBe(false);
    expect(imported).toHaveLength(0);
  });

  it("09-12 真跑根修:冷引擎期上传失败不钉死——就绪失效指纹后整轮重传", async () => {
    storeState.storyboards = [shot("S01-01", 1, { kind: "image", path: "project-file://a.png" })];
    storeState.entityExtractions = [] as unknown[];
    // 第一轮=引擎冷(上传全败),库导入成功→指纹仍缓存(旧缺陷:从此跳过)
    const cold = makeDeps();
    cold.deps.uploadPreview = async () => false;
    await expect(syncStoryboardOverviewToLibrary({ ...cold.deps, transport: cold.transport })).resolves.toBe(true);
    expect(cold.imported).toHaveLength(1);

    // 同指纹第二次:零动作(指纹守卫仍成立)
    const skipped = makeDeps();
    skipped.deps.uploadPreview = async () => false;
    await syncStoryboardOverviewToLibrary({ ...skipped.deps, transport: skipped.transport });
    expect(skipped.imported).toHaveLength(0);

    // 引擎就绪瞬失效→下一轮整轮重传成功
    invalidateOverviewSyncForEngineStart();
    const warm = makeDeps();
    await expect(syncStoryboardOverviewToLibrary({ ...warm.deps, transport: warm.transport })).resolves.toBe(true);
    expect(warm.uploads).toEqual([{ name: "my-shot-S01-01.jpg", b64: "cmF3" }]);
    expect(warm.imported).toHaveLength(1);
  });
});

describe("ensureStageAssetCoversUploaded(09-12 v4:autoOpen/保鲜共享封面转换)", () => {
  beforeEach(() => {
    resetOverviewSyncForTests();
  });

  function assetPayload(cover?: string): StageNodePayload[] {
    return [{ key: "assets", assets: [{ name: "独孤剑尘", cover }] } as unknown as StageNodePayload];
  }

  it("app-scheme cover 上传为 my-asset-<URL戳>.jpg 并改写;URL 定名多章节不串图", async () => {
    const { deps, uploads } = makeDeps();
    const payloads = assetPayload("asset-file://role/dugu.png?thumb=1");
    await ensureStageAssetCoversUploaded(payloads, deps);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].name).toMatch(/^my-asset-[0-9a-f]{8}\.jpg$/);
    expect(uploads[0].name).not.toBe("my-asset-1.jpg"); // 位置序号=多章覆盖串图,禁回归
    expect(payloads[0].assets?.[0].cover).toBe(uploads[0].name);

    // 同 cover 第二次(另一章/重开):会话缓存命中,零重传且直接改写
    const again = makeDeps();
    const second = assetPayload("asset-file://role/dugu.png?thumb=1");
    await ensureStageAssetCoversUploaded(second, again.deps);
    expect(again.uploads).toHaveLength(0);
    expect(second[0].assets?.[0].cover).toBe(uploads[0].name);
  });

  it("已是引擎文件名/无 cover/上传失败:保留原值不阻断(字牌降级契约)", async () => {
    const { deps, uploads } = makeDeps();
    const named = assetPayload("my-asset-0123abcd.jpg");
    await ensureStageAssetCoversUploaded(named, deps);
    expect(named[0].assets?.[0].cover).toBe("my-asset-0123abcd.jpg");

    const none = assetPayload(undefined);
    await ensureStageAssetCoversUploaded(none, deps);
    expect(none[0].assets?.[0].cover).toBeUndefined();

    const failing = makeDeps();
    failing.deps.uploadPreview = async () => false;
    const doomed = assetPayload("project-file://x/exports/y.jpg");
    await ensureStageAssetCoversUploaded(doomed, failing.deps);
    expect(doomed[0].assets?.[0].cover).toBe("project-file://x/exports/y.jpg");
    expect(uploads).toHaveLength(0);
  });
});
