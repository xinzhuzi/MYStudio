// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import {
  compileComfySubgraph,
  type ComfySubgraphEdgeInput,
  type ComfySubgraphNodeInput,
} from "./comfy-subgraph-compiler";
import type { ComfyEffectNodeDescriptor } from "./comfy-effect-catalog";

/** 图像效果节点(IMAGE 进 IMAGE 出)descriptor 夹具 */
function imageEffectDescriptor(): ComfyEffectNodeDescriptor {
  return {
    ports: [
      { id: "image", label: "图片", type: "IMAGE", side: "input" },
      { id: "0", label: "输出", type: "IMAGE", side: "output" },
    ],
    widgets: [
      { id: "blur_radius", label: "blur_radius", zhLabel: "模糊半径", type: "INT", default: 1, min: 1, max: 128 },
    ],
  };
}

function genericNode(id: string, classType = "ImageBlur", overrides: Partial<ComfySubgraphNodeInput> = {}): ComfySubgraphNodeInput {
  return {
    id,
    type: "comfy-generic",
    title: id,
    classType,
    descriptor: imageEffectDescriptor(),
    ...overrides,
  };
}

function referenceNode(id: string, imageUrl = "local-image://ref.png"): ComfySubgraphNodeInput {
  return { id, type: "reference", title: id, imageUrl };
}

function promptNode(id: string, prompt = "一只猫", negativePrompt?: string): ComfySubgraphNodeInput {
  return { id, type: "prompt", title: id, prompt, negativePrompt };
}

function compile(
  nodes: ComfySubgraphNodeInput[],
  edges: ComfySubgraphEdgeInput[],
  selection: string[],
) {
  return compileComfySubgraph({ nodes, edges, selection });
}

describe("compileComfySubgraph(子图编译器,09-08 三期收官)", () => {
  it("单节点子图:widget 默认值落 inputs + 末端自动补 SaveImage", () => {
    const result = compile([genericNode("a")], [], ["a"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.a).toEqual({
      class_type: "ImageBlur",
      inputs: { blur_radius: 1 },
    });
    expect(result.graph.__save_1.class_type).toBe("SaveImage");
    expect(result.graph.__save_1.inputs.images).toEqual(["a", 0]);
    expect(result.terminals).toEqual([{ saveNodeId: "__save_1", canvasNodeId: "a", nodeTitle: "a" }]);
    expect(result.pendingImages).toEqual([]);
  });

  it("widget 现值覆盖默认值;缺省 widget 只在有默认值时进 inputs", () => {
    const node = genericNode("a", "ImageBlur", {
      descriptor: {
        ports: [{ id: "0", label: "输出", type: "IMAGE", side: "output" }],
        widgets: [
          { id: "radius", label: "radius", type: "INT", default: 1 },
          { id: "no_default", label: "nd", type: "STRING" },
        ],
      },
      widgetValues: { radius: 7 },
    });
    const result = compile([node], [], ["a"]);
    expect(result.ok && result.graph.a.inputs).toEqual({ radius: 7 });
  });

  it("内部连线:sourceHandle 槽位/targetHandle 口别映射成 [源, 槽]", () => {
    const twoOutputs = genericNode("src", "LayerMask", {
      descriptor: {
        ports: [
          { id: "0", label: "图", type: "IMAGE", side: "output" },
          { id: "1", label: "遮罩", type: "MASK", side: "output" },
          { id: "image", label: "图片", type: "IMAGE", side: "input" },
        ],
        widgets: [],
      },
    });
    const dst = genericNode("dst");
    const result = compile(
      [twoOutputs, dst],
      [{ source: "src", target: "dst", sourceHandle: "1", targetHandle: "image" }],
      ["src", "dst"],
    );
    expect(result.ok && result.graph.dst.inputs.image).toEqual(["src", 1]);
    // dst 是唯一末端(下游被连走),SaveImage 挂 dst
    expect(result.ok && result.terminals[0].canvasNodeId).toBe("dst");
  });

  it("无 handle 回落:目标取首个 IMAGE 输入口,源取槽 0", () => {
    const src = genericNode("src");
    const dst = genericNode("dst");
    const result = compile([src, dst], [{ source: "src", target: "dst" }], ["src", "dst"]);
    expect(result.ok && result.graph.dst.inputs.image).toEqual(["src", 0]);
  });

  it("外部提示词:STRING 口直填文本(负口连负向文本)", () => {
    const target = genericNode("t", "SomeTextSink", {
      descriptor: {
        ports: [
          { id: "text", label: "文本", type: "STRING", side: "input" },
          { id: "0", label: "输出", type: "IMAGE", side: "output" },
        ],
        widgets: [],
      },
    });
    const positive = compile(
      [promptNode("p", "一只猫", "低质量"), target],
      [{ source: "p", target: "t", targetHandle: "text" }],
      ["t"],
    );
    expect(positive.ok && positive.graph.t.inputs.text).toBe("一只猫");
    const negative = compile(
      [promptNode("p", "一只猫", "低质量"), target],
      [{ source: "p", target: "t", targetHandle: "text", sourceHandle: "negative" }],
      ["t"],
    );
    expect(negative.ok && negative.graph.t.inputs.text).toBe("低质量");
  });

  it("外部图:IMAGE 口挂虚拟 LoadImage + pendingImages 供运行方回填 b64", () => {
    const target = genericNode("t");
    const result = compile(
      [referenceNode("ref"), target],
      [{ source: "ref", target: "t", targetHandle: "image" }],
      ["t"],
    );
    expect(result.ok && result.graph.__upload_1).toEqual({
      class_type: "LoadImage",
      inputs: { image: "__pending__" },
    });
    expect(result.ok && result.graph.t.inputs.image).toEqual(["__upload_1", 0]);
    expect(result.ok && result.pendingImages).toEqual([
      { key: "__upload_1.image", name: "subgraph-1.png", sourceNodeId: "ref" },
    ]);
  });

  it("上游图未就绪(空参考图/未运行的工作流节点)给大白话", () => {
    const target = genericNode("t");
    const emptyRef = compile(
      [referenceNode("ref", ""), target],
      [{ source: "ref", target: "t" }],
      ["t"],
    );
    expect(emptyRef.ok).toBe(false);
    expect(!emptyRef.ok && emptyRef.error).toContain("还没有图");

    const notRunWorkflow = compile(
      [{ id: "wf", type: "comfy-workflow", title: "工作流" }, target],
      [{ source: "wf", target: "t" }],
      ["t"],
    );
    expect(notRunWorkflow.ok).toBe(false);
    expect(!notRunWorkflow.ok && notRunWorkflow.error).toContain("先在它卡上点「运行」");
  });

  it("环检测:循环连线大白话拒绝", () => {
    const a = genericNode("a");
    const b = genericNode("b");
    const result = compile(
      [a, b],
      [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ],
      ["a", "b"],
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("循环");
  });

  it("缺 classType/缺 descriptor 大白话报错", () => {
    const noClass = compile(
      [{ id: "x", type: "comfy-generic", title: "x", descriptor: imageEffectDescriptor() }],
      [],
      ["x"],
    );
    expect(noClass.ok).toBe(false);
    expect(!noClass.ok && noClass.error).toContain("缺少节点类型声明");
    const noDescriptor = compile(
      [{ id: "x", type: "comfy-generic", title: "x", classType: "ImageBlur" }],
      [],
      ["x"],
    );
    expect(noDescriptor.ok).toBe(false);
    expect(!noDescriptor.ok && noDescriptor.error).toContain("缺少端口声明");
  });

  it("选区没有效果节点时拒绝(含仅选工作流节点的场景)", () => {
    const result = compile(
      [referenceNode("ref"), { id: "wf", type: "comfy-workflow", title: "wf" }],
      [],
      ["ref", "wf"],
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("没有效果节点");
  });

  it("口类型不匹配:提示词连 IMAGE 口/图片连 STRING 口大白话拒绝", () => {
    const promptToImage = compile(
      [promptNode("p"), genericNode("t")],
      [{ source: "p", target: "t", targetHandle: "image" }],
      ["t"],
    );
    expect(promptToImage.ok).toBe(false);
    expect(!promptToImage.ok && promptToImage.error).toContain("只能连到文本口");

    const target = genericNode("t", "Sink", {
      descriptor: {
        ports: [
          { id: "text", label: "文本", type: "STRING", side: "input" },
          { id: "0", label: "输出", type: "IMAGE", side: "output" },
        ],
        widgets: [],
      },
    });
    const imageToString = compile(
      [referenceNode("ref"), target],
      [{ source: "ref", target: "t", targetHandle: "text" }],
      ["t"],
    );
    expect(imageToString.ok).toBe(false);
    expect(!imageToString.ok && imageToString.error).toContain("只能连到图像口");
  });

  it("悬空类型口(MODEL/CONDITIONING 未供源)大白话拒绝", () => {
    const sampler = genericNode("ks", "KSampler", {
      descriptor: {
        ports: [
          { id: "model", label: "模型", type: "MODEL", side: "input" },
          { id: "positive", label: "正向条件", type: "CONDITIONING", side: "input" },
          { id: "0", label: "输出", type: "LATENT", side: "output" },
        ],
        widgets: [],
      },
    });
    const result = compile([sampler], [], ["ks"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("没有来源");
    expect(!result.ok && result.error).toContain("工作流节点封装");
  });

  it("同一输入口两根线:后线拒绝(一根口只接一根)", () => {
    const target = genericNode("t");
    const result = compile(
      [referenceNode("r1"), referenceNode("r2"), target],
      [
        { source: "r1", target: "t" },
        { source: "r2", target: "t" },
      ],
      ["t"],
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("只能接一根");
  });

  it("多末端:每个有 IMAGE 输出的末端各补一个 SaveImage(顺序对回画布)", () => {
    const a = genericNode("a");
    const b = genericNode("b");
    const result = compile([a, b], [], ["a", "b"]);
    expect(result.ok && result.terminals.length).toBe(2);
    expect(result.ok && result.graph.__save_1.inputs.filename_prefix).toBe("mystudio_subgraph/1");
    expect(result.ok && result.graph.__save_2.inputs.filename_prefix).toBe("mystudio_subgraph/2");
  });

  it("全无 IMAGE 输出末端时拒绝(没法出图)", () => {
    const maskNode = genericNode("m", "ImageToMask", {
      descriptor: {
        ports: [
          { id: "image", label: "图片", type: "IMAGE", side: "input" },
          { id: "0", label: "遮罩", type: "MASK", side: "output" },
        ],
        widgets: [],
      },
    });
    const result = compile([maskNode], [], ["m"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("无法出图");
  });
});
