// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it, vi } from "vitest";

const generateImageMock = vi.hoisted(() => vi.fn());
const saveToMediaLibraryMock = vi.hoisted(() => vi.fn(() => "media-1"));
const maybeAutoDenoiseMock = vi.hoisted(() => vi.fn(async (url: string) => url));
const saveImageToLocalMock = vi.hoisted(() =>
  vi.fn(async () => "local-image://ai-image/studio_saved.png"),
);
const prepareReferencesMock = vi.hoisted(() => vi.fn(async (values: string[]) => values));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: generateImageMock },
}));
vi.mock("@/lib/ai/generation-media", () => ({
  saveToMediaLibrary: saveToMediaLibraryMock,
}));
vi.mock("@/lib/ai/image-auto-denoise", () => ({
  maybeAutoDenoiseUrl: maybeAutoDenoiseMock,
}));
vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: saveImageToLocalMock,
  readImageAsBase64: vi.fn(async () => null),
}));
vi.mock("@/lib/bridge/project-files", () => ({
  // 09-02 治理:生成图落项目内(项目桥必须可用才落盘);测试统一给可用桥
  getProjectFilesBridge: vi.fn(() => ({
    saveImage: saveImageMock,
    readText: vi.fn(async () => ({ text: "" })),
    writeText: vi.fn(async () => ({ success: true })),
  })),
}));

const saveImageMock = vi.hoisted(() =>
  vi.fn(async (_payload: { projectId: string; relativePath: string; source: string }) => ({
    success: true,
    url: `project-file://mock/${_payload.relativePath}`,
  })),
);
vi.mock("@/lib/studio/image-workflow-references", () => ({
  prepareImageWorkflowReferenceImages: prepareReferencesMock,
}));

import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { runImageStudioNodeGeneration } from "./run-node-generation";
import type { ImageWorkflowGraph } from "@/types/studio";

function buildGraph(): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph();
  graph = addPromptImageNode(graph, {
    id: "prompt-1",
    prompt: "山门晨雾",
    negativePrompt: "模糊",
    position: { x: 0, y: 0 },
  });
  graph = addGeneratedImageNode(graph, {
    id: "gen-1",
    prompt: "山门晨雾",
    model: "krea2-turbo",
    aspectRatio: "16:9",
    position: { x: 100, y: 0 },
  });
  graph = addReferenceImageNode(graph, {
    id: "ref-1",
    imageUrl: "local-image://upload/ref.png",
    position: { x: 0, y: 100 },
  });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
  graph = connectImageWorkflowNodes(graph, { source: "ref-1", target: "gen-1" });
  return graph;
}

beforeEach(() => {
  generateImageMock.mockReset();
  saveImageMock.mockReset();
  saveImageMock.mockImplementation(async (payload: { relativePath: string }) => ({
    success: true,
    url: `project-file://mock/${payload.relativePath}`,
  }));
  maybeAutoDenoiseMock.mockClear();
  prepareReferencesMock.mockClear();
  saveToMediaLibraryMock.mockClear();
});

describe("runImageStudioNodeGeneration", () => {
  it("图生图全链:参考图经转换透传,persistMedia:false,结果落项目内稳定地址+媒体库", async () => {
    generateImageMock.mockResolvedValueOnce({ url: "https://cdn.example.com/x.png", mediaId: undefined });

    const result = await runImageStudioNodeGeneration(buildGraph(), "gen-1");

    expect(prepareReferencesMock).toHaveBeenCalledWith(["local-image://upload/ref.png"], expect.anything());
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const params = generateImageMock.mock.calls[0][0];
    expect(params.prompt).toBe("山门晨雾");
    expect(params.negativePrompt).toBe("模糊");
    expect(params.model).toBe("krea2-turbo");
    expect(params.aspectRatio).toBe("16:9");
    expect(params.persistMedia).toBe(false);
    expect(maybeAutoDenoiseMock).toHaveBeenCalledWith("https://cdn.example.com/x.png");
    // 09-02 治理:落项目内 media/ai-image/YYYY-MM/(project-file://,随项目走)
    expect(result.imageUrl).toMatch(/^project-file:\/\/mock\/media\/ai-image\/\d{4}-\d{2}\//);
    expect(result.persisted).toBe(true);
    expect(result.mediaId).toBe("media-1");
    expect(saveToMediaLibraryMock).toHaveBeenCalledWith(
      result.imageUrl,
      "山门晨雾",
      "ai-image",
    );
  });

  it("模型专属参数原样透传进 extraParams(质量档已随节点字段下线)", async () => {
    generateImageMock.mockResolvedValueOnce({ url: "https://cdn.example.com/x.png" });

    await runImageStudioNodeGeneration(buildGraph(), "gen-1", { extraParams: { stylization: 250 } });

    const params = generateImageMock.mock.calls[0][0];
    expect(params.extraParams).toEqual({ stylization: 250 });
  });

  it("空提示词直接抛错,不触发生图", async () => {
    const graph = buildGraph();
    const emptied = {
      ...graph,
      nodes: graph.nodes.map((node) => ("prompt" in node ? { ...node, prompt: "" } : node)),
    };
    await expect(runImageStudioNodeGeneration(emptied, "gen-1")).rejects.toThrow("请先填写生成提示词");
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("项目落盘失败→chat 形态重试一次,重试成功返回项目稳定地址", async () => {
    generateImageMock
      .mockResolvedValueOnce({ url: "https://cdn.example.com/lost.png" })
      .mockResolvedValueOnce({ url: "data:image/png;base64,ZZZ" });
    saveImageMock
      .mockRejectedValueOnce(new Error("项目落盘失败"))
      .mockResolvedValueOnce({ success: true, url: "project-file://mock/media/ai-image/2026-09/retry.png" });

    const result = await runImageStudioNodeGeneration(buildGraph(), "gen-1");

    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(generateImageMock.mock.calls[1][0].transport).toBe("chat");
    expect(result.imageUrl).toBe("project-file://mock/media/ai-image/2026-09/retry.png");
    expect(result.persisted).toBe(true);
  });

  it("项目桥持续失败:返回原始地址并标记 persisted:false(绝不回退 userData)", async () => {
    generateImageMock.mockResolvedValue({ url: "data:image/png;base64,ZZZ" });
    saveImageMock.mockRejectedValue(new Error("项目落盘失败"));

    const result = await runImageStudioNodeGeneration(buildGraph(), "gen-1");

    expect(result.persisted).toBe(false);
    expect(result.imageUrl).toBe("data:image/png;base64,ZZZ");
    // 媒体库记录仍建立(内部异步下载是第二次落盘机会)
    expect(saveToMediaLibraryMock).toHaveBeenCalled();
  });
});
