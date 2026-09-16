// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// jsdom:window 桥替换位用例需要 window 存在
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createComfyWorkflowLibraryClient,
  createInMemoryComfyWorkflowLibraryTransport,
  getComfyWorkflowLibraryTransport,
} from "./comfy-workflow-library";
import krea2T2i from "../../../../backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-krea2_t2i.json";

const T2I_JSON = JSON.stringify(krea2T2i);

function smallWorkflow(text: string): string {
  return JSON.stringify({
    "1": { class_type: "CLIPTextEncode", inputs: { text, clip: ["0", 0] } },
    "0": { class_type: "CLIPLoader", inputs: { clip_name: "a.safetensors" } },
  });
}

describe("createInMemoryComfyWorkflowLibraryTransport 库服务", () => {
  it("list:条目带节点数与缺失插件标记(object_info 摘要注入口径)", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "K2 文生图", content: T2I_JSON }],
      availableClassTypes: ["KSampler", "UNETLoader"],
    });
    const tree = await transport.list();
    expect(tree.workflows).toHaveLength(1);
    expect(tree.workflows[0].nodeCount).toBe(10);
    // 缺 KSampler/UNETLoader 之外的全部(缺插件红标数据源)
    expect(tree.workflows[0].missingClassTypes).toContain("CLIPTextEncode");
    expect(tree.workflows[0].missingClassTypes).not.toContain("KSampler");
  });

  it("importFiles:新名直接入库;坏 JSON 单文件失败不拖累整批", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport();
    const results = await transport.importFiles(
      [
        { name: "新流.json", content: smallWorkflow("x") },
        { name: "坏的.json", content: "{oops" },
      ],
      "skip",
    );
    expect(results[0]).toMatchObject({ name: "新流.json", status: "imported" });
    expect(results[1]).toMatchObject({ name: "坏的.json", status: "failed" });
    expect((await transport.list()).workflows).toHaveLength(1);
  });

  it("importFiles 同名冲突三模式:跳过/覆盖/两者保留", async () => {
    // 跳过:库内保留旧内容
    const skipTransport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "同名", content: smallWorkflow("旧") }],
    });
    const skipped = await skipTransport.importFiles(
      [{ name: "同名.json", content: smallWorkflow("新") }],
      "skip",
    );
    expect(skipped[0]).toMatchObject({ status: "skipped", reason: "conflict" });
    const treeAfterSkip = await skipTransport.list();
    expect(treeAfterSkip.workflows).toHaveLength(1);

    // 覆盖:同名条目内容更新,数量不变
    const overwriteTransport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "同名", content: smallWorkflow("旧") }],
    });
    const overwritten = await overwriteTransport.importFiles(
      [{ name: "同名.json", content: smallWorkflow("新") }],
      "overwrite",
    );
    expect(overwritten[0]).toMatchObject({ status: "imported" });
    const treeAfterOverwrite = await overwriteTransport.list();
    expect(treeAfterOverwrite.workflows).toHaveLength(1);
    expect((await overwriteTransport.content(treeAfterOverwrite.workflows[0].id))).toContain("新");

    // 两者保留:自动改名「名 2」,两条并存
    const keepBothTransport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "同名", content: smallWorkflow("旧") }],
    });
    const kept = await keepBothTransport.importFiles(
      [{ name: "同名.json", content: smallWorkflow("新") }],
      "keep-both",
    );
    expect(kept[0]).toMatchObject({ status: "renamed", renamedTo: "同名 2" });
    expect((await keepBothTransport.list()).workflows.map((w) => w.name).sort())
      .toEqual(["同名", "同名 2"]);
  });

  it("重命名/移动:条目改名换夹;文件夹删后工作流回落根层不丢数据", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport({
      folders: [{ id: "f1", name: "NSFW", parentId: null }],
      workflows: [{ name: "流A", content: smallWorkflow("a"), folderId: null }],
    });
    const tree0 = await transport.list();
    const wfId = tree0.workflows[0].id;
    expect(await transport.renameWorkflow(wfId, "改名了")).toEqual({ ok: true });
    expect(await transport.moveWorkflow(wfId, "f1")).toEqual({ ok: true });
    const tree1 = await transport.list();
    expect(tree1.workflows[0]).toMatchObject({ name: "改名了", folderId: "f1" });
    expect((await transport.list()).workflows[0]).toMatchObject({ folderId: "f1" });

    expect(await transport.deleteFolder("f1")).toEqual({ ok: true });
    const tree2 = await transport.list();
    expect(tree2.folders).toHaveLength(0);
    expect(tree2.workflows[0].folderId).toBeNull();
    expect(tree2.workflows[0].name).toBe("改名了");
  });

  it("删除保护流程:scanDeleteReferences 先拿引用清单,deleteWorkflow 才执行", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "被引用流", content: smallWorkflow("x") }],
      deleteScanReferences: [
        { kind: "画布", name: "画布 1" },
        { kind: "工作流节点", name: "成图 3" },
      ],
    });
    const tree0 = await transport.list();
    const id = tree0.workflows[0].id;
    // 第一步:扫描不删除
    const scan = await transport.scanDeleteReferences(id);
    expect(scan.references).toHaveLength(2);
    expect((await transport.list()).workflows).toHaveLength(1);
    // 第二步:确认后删除
    expect(await transport.deleteWorkflow(id)).toEqual({ ok: true });
    expect((await transport.list()).workflows).toHaveLength(0);
  });

  it("createFolder:新建/重命名文件夹", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport();
    const folder = await transport.createFolder("我的文件夹", null);
    expect(folder.name).toBe("我的文件夹");
    expect(await transport.renameFolder(folder.id, "改名")).toEqual({ ok: true });
    expect((await transport.list()).folders[0].name).toBe("改名");
  });
});

describe("createComfyWorkflowLibraryClient(通道包装)", () => {
  it("透传契约方法;名称入参归一(空名回落默认)", async () => {
    const transport = createInMemoryComfyWorkflowLibraryTransport({
      workflows: [{ name: "流A", content: smallWorkflow("a") }],
    });
    const client = createComfyWorkflowLibraryClient(transport);
    const tree = await client.refresh();
    expect(tree.workflows).toHaveLength(1);
    const id = tree.workflows[0].id;
    await client.renameWorkflow(id, "  ");
    expect((await client.refresh()).workflows[0].name).toBe("未命名工作流");
    const folder = await client.createFolder(" ", null);
    expect(folder.name).toBe("新文件夹");
    expect(await client.content(id)).toContain("CLIPTextEncode");
    expect((await client.listAvailableClassTypes())).toEqual([]);
  });
});

describe("getComfyWorkflowLibraryTransport(真实通道替换位)", () => {
  it("window 桥缺席=undefined(preload 未注入时不硬连);注入即启用", async () => {
    expect(getComfyWorkflowLibraryTransport()).toBeUndefined();
    const fake = createInMemoryComfyWorkflowLibraryTransport();
    (window as { comfyWorkflowLibrary?: unknown }).comfyWorkflowLibrary = fake;
    try {
      expect(getComfyWorkflowLibraryTransport()).toBe(fake);
    } finally {
      delete (window as { comfyWorkflowLibrary?: unknown }).comfyWorkflowLibrary;
    }
  });
});
