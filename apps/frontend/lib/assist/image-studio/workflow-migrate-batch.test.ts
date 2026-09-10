// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  migrateWorkflowsToLibrary,
  type MigrateBatchDeps,
} from "@/lib/assist/image-studio/workflow-migrate-batch";
import type { ComfyWorkflowImportFile, ComfyWorkflowImportFileResult } from "@/lib/assist/image-studio/comfy-workflow-library";
import type { ImageWorkflowGraph } from "@/types/studio";

function flow(name: string, withReference: boolean): ImageWorkflowGraph {
  const nodes: Array<Record<string, unknown>> = [
    { id: "p1", type: "prompt", prompt: `${name} 提示词`, aspectRatio: "1:1", position: { x: 0, y: 0 } },
    { id: "g1", type: "generated", prompt: "", aspectRatio: "1:1", status: "idle", position: { x: 1, y: 1 } },
  ];
  const edges: Array<Record<string, unknown>> = [{ id: "e1", source: "p1", target: "g1" }];
  if (withReference) {
    nodes.push({ id: "r1", type: "reference", imageUrl: "project-file://media/ref.png", position: { x: 2, y: 2 } });
    edges.push({ id: "e2", source: "r1", target: "g1" });
  }
  return {
    id: `wf-${name}`, name, target: { kind: "storyboard", id: "sb-1" },
    nodes: nodes as unknown as ImageWorkflowGraph["nodes"], edges: edges as unknown as ImageWorkflowGraph["edges"],
    createdAt: 0, updatedAt: 0,
  } as unknown as ImageWorkflowGraph;
}

function emptyFlow(name: string): ImageWorkflowGraph {
  return { ...flow(name, false), nodes: [{ id: "s1", type: "sticky", position: { x: 0, y: 0 } } as never] } as unknown as ImageWorkflowGraph;
}

function makeDeps(overrides: Partial<MigrateBatchDeps> = {}) {
  const importedFiles: ComfyWorkflowImportFile[] = [];
  const uploads: string[] = [];
  const deps: MigrateBatchDeps = {
    flows: [flow("道劫41", true), flow("自由流", false), emptyFlow("空图")],
    transport: {
      importFiles: async (files, mode) => {
        expect(mode).toBe("skip"); // 无值守入口默认幂等 skip(09-09 迁移链打通)
        importedFiles.push(...files);
        return files.map(
          (file): ComfyWorkflowImportFileResult => ({ name: file.name, status: "imported", id: `id-${file.name}` }),
        );
      },
    },
    uploadReference: async (name) => {
      uploads.push(name);
      return true;
    },
    readImageB64: async (url) => (url.startsWith("project-file://") ? "data:image/png;base64,aGVsbG8=" : null),
    ...overrides,
  };
  return { deps, importedFiles, uploads };
}

describe("migrateWorkflowsToLibrary", () => {
  it("逐流入库:命名+UI 载荷可解析+apiFormat 随身+参考图按占位名上传", async () => {
    const { deps, importedFiles, uploads } = makeDeps();
    const summary = await migrateWorkflowsToLibrary(deps);

    expect(summary.total).toBe(3);
    expect(summary.imported).toBe(2);
    expect(summary.skippedNoBlocks).toBe(1);
    expect(importedFiles.map((file) => file.name)).toEqual(["迁移 · 道劫41.json", "迁移 · 自由流.json"]);
    // UI 载荷可解析且带 manying 终端与 API 格式随身
    const payload = JSON.parse(importedFiles[0].content) as { nodes: Array<{ type: string }>; extra: { apiFormat?: unknown } };
    expect(payload.nodes.some((node) => node.type === "ManyingGenerated")).toBe(true);
    expect(payload.extra.apiFormat).toBeTruthy();
    // 参考图:project-file 可读→上传(data: 前缀被剥)
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/^manying-ref-1-[0-9a-f]{8}\.png$/);
    expect(summary.referencesUploaded).toBe(1);
  });

  it("参考图不可读协议(asset-file)→best-effort 跳过+注记,不阻断入库", async () => {
    const { deps, importedFiles } = makeDeps({
      readImageB64: async () => null,
    });
    const summary = await migrateWorkflowsToLibrary(deps);
    expect(summary.imported).toBe(2);
    expect(summary.referencesSkipped).toBe(1);
    expect(summary.notes.some((note) => note.includes("参考图读取失败"))).toBe(true);
    expect(importedFiles).toHaveLength(2);
  });

  it("上传失败(引擎未跑)→跳过+注记;导入失败逐条入 failed", async () => {
    const { deps } = makeDeps({
      uploadReference: async () => false,
      transport: {
        importFiles: async (files) =>
          files.map((file, index): ComfyWorkflowImportFileResult =>
            index === 0 ? { name: file.name, status: "failed", error: "坏 JSON" } : { name: file.name, status: "imported", id: "x" }),
      },
    });
    const summary = await migrateWorkflowsToLibrary(deps);
    expect(summary.imported).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.referencesSkipped).toBe(1);
    expect(summary.notes.some((note) => note.includes("引擎须在运行"))).toBe(true);
    expect(summary.notes.some((note) => note.includes("坏 JSON"))).toBe(true);
  });

  it("零流:零导入零炸", async () => {
    const { deps } = makeDeps({ flows: [] });
    const summary = await migrateWorkflowsToLibrary(deps);
    expect(summary).toMatchObject({ total: 0, imported: 0, failed: 0 });
  });
});
