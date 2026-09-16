// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import {
  analyzeComfyWorkflow,
  analyzeComfyWorkflowText,
  detectMissingClassTypes,
  formatMissingClassTypesMessage,
  unwrapComfyApiGraph,
} from "./comfy-workflow-import";
// 夹具=桥模板(API 格式,{schemaVersion, graph} 包装),与生产分析输入同源
import krea2T2i from "../../../../backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-krea2_t2i.json";
import krea2NsfwPro from "../../../../backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-krea2_nsfw_pro.json";
import krea2UnclothInstruct from "../../../../backend/engines/comfyui/workflows/1_图片/K2图像/3_改图/MY-krea2_uncloth_instruct.json";
import krea2EditRef from "../../../../backend/engines/comfyui/workflows/1_图片/K2图像/3_改图/MY-krea2_edit_ref.json";

describe("analyzeComfyWorkflow 夹具快照(09-08 二期)", () => {
  it("krea2_t2i:文生图——≥1 提示词口(正/负极性各一),无图口", () => {
    const result = analyzeComfyWorkflow(krea2T2i);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { descriptor } = result;

    const promptPorts = descriptor.ports.filter((p) => p.type === "prompt-text");
    expect(promptPorts.length).toBeGreaterThanOrEqual(1);
    expect(promptPorts.map((p) => p.label).sort()).toEqual(["正向提示词", "负向提示词"]);
    expect(descriptor.ports.some((p) => p.type === "image")).toBe(false);
    expect(descriptor.nodeCount).toBe(10);
    expect(descriptor.widgets.length).toBeGreaterThan(0);
    expect(descriptor).toMatchSnapshot();
  });

  it("krea2_edit_ref:双参考图——2 图口(LoadImage),指令口带极性", () => {
    const result = analyzeComfyWorkflow(krea2EditRef);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { descriptor } = result;

    const imagePorts = descriptor.ports.filter((p) => p.type === "image");
    expect(imagePorts.length).toBe(2);
    expect(imagePorts.map((p) => p.label)).toEqual(["参考图 1", "参考图 2"]);
    const promptPorts = descriptor.ports.filter((p) => p.type === "prompt-text");
    expect(promptPorts.map((p) => p.label).sort()).toEqual(["正向提示词", "负向提示词"]);
    // system_prompt 照 09-07 终裁:回归节点编辑器字段,不占输入口
    expect(descriptor.ports.some((p) => p.inputKey === "system_prompt")).toBe(false);
    expect(descriptor.widgets.some((w) => w.inputKey === "system_prompt" && w.label === "系统提示词")).toBe(true);
    expect(descriptor.nodeCount).toBe(18);
    expect(descriptor).toMatchSnapshot();
  });

  it("krea2_nsfw_pro:classTypesUsed 断言(NSFW专业流节点全录)", () => {
    const result = analyzeComfyWorkflow(krea2NsfwPro);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { descriptor } = result;

    expect(descriptor.classTypesUsed).toEqual([
      "CLIPLoader",
      "CLIPTextEncode",
      "ConditioningKrea2Rebalance",
      "ConditioningZeroOut",
      "EmptyLatentImage",
      "KSampler",
      "LoraLoaderModelOnly",
      "SaveImage",
      "UNETLoader",
      "VAEDecode",
      "VAELoader",
    ]);
    expect(descriptor.nodeCount).toBe(13);
    // 正向经 ConditioningKrea2Rebalance 中转:55 号无直接 positive 边 → 泛化标签
    const promptPorts = descriptor.ports.filter((p) => p.type === "prompt-text");
    expect(promptPorts.length).toBe(2);
    expect(promptPorts.some((p) => p.label === "负向提示词" && p.polarity === "negative")).toBe(true);
    expect(descriptor).toMatchSnapshot();
  });

  it("krea2_uncloth_instruct:单参考图——1 图口,双指令口", () => {
    const result = analyzeComfyWorkflow(krea2UnclothInstruct);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { descriptor } = result;

    expect(descriptor.ports.filter((p) => p.type === "image")).toHaveLength(1);
    expect(descriptor.ports.filter((p) => p.type === "prompt-text").map((p) => p.label).sort())
      .toEqual(["正向提示词", "负向提示词"]);
    expect(descriptor.nodeCount).toBe(15);
    expect(descriptor).toMatchSnapshot();
  });
});

describe("analyzeComfyWorkflow widget 类型与边界行为", () => {
  it("widget 值形状推断:INT/FLOAT/BOOLEAN/STRING/COMBO;内部连线不外露", () => {
    const result = analyzeComfyWorkflow({
      "1": {
        class_type: "KSampler",
        inputs: {
          model: ["0", 0], // 内部连线 → 不是 widget/口
          seed: 42,
          cfg: 1.5,
          denoise: 0.85,
          sampler_name: "euler",
          scheduler: "simple",
        },
      },
      "0": { class_type: "UNETLoader", inputs: { unet_name: "a.safetensors" } },
      "2": { class_type: "PreviewImage", inputs: { images: ["1", 0], any_bool: true } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const widgetType = (key: string) =>
      result.descriptor.widgets.find((w) => w.inputKey === key)?.type;
    expect(widgetType("seed")).toBe("INT");
    expect(widgetType("cfg")).toBe("FLOAT");
    expect(widgetType("denoise")).toBe("FLOAT");
    expect(widgetType("sampler_name")).toBe("COMBO");
    expect(widgetType("unet_name")).toBe("STRING");
    expect(widgetType("any_bool")).toBe("BOOLEAN");
    // 连线值(model/images)不产生 widget 也不产生口
    expect(result.descriptor.widgets.some((w) => w.inputKey === "model")).toBe(false);
    expect(result.descriptor.ports).toHaveLength(0);
  });

  it("IMAGE 型输入且无来源(原始值占位)→ 图口", () => {
    const result = analyzeComfyWorkflow({
      "1": { class_type: "SomeEditNode", inputs: { image: "", prompt: "改一下" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor.ports.map((p) => p.type)).toEqual(["image", "prompt-text"]);
  });

  it("object_info 注入:升级 COMBO 选项与数值范围;缺插件检测内联", () => {
    const available = ["KSampler", "UNETLoader", "PreviewImage"];
    const result = analyzeComfyWorkflow(
      {
        "1": {
          class_type: "KSampler",
          inputs: { model: ["0", 0], seed: 1, steps: 8, sampler_name: "euler" },
        },
        "0": { class_type: "UNETLoader", inputs: { unet_name: "a.safetensors" } },
        "2": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
      },
      {
        availableClassTypes: [...available, "PreviewImage"],
        objectInfoByClassType: {
          KSampler: {
            inputs: { sampler_name: "COMBO", steps: "INT" },
            combos: { sampler_name: ["euler", "dpmpp_2m"] },
            ranges: { steps: { min: 1, max: 50, step: 1 } },
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { descriptor } = result;
    expect(descriptor.missing).toEqual([]);
    const combo = descriptor.widgets.find((w) => w.inputKey === "sampler_name");
    expect(combo?.options).toEqual(["euler", "dpmpp_2m"]);
    const steps = descriptor.widgets.find((w) => w.inputKey === "steps");
    expect(steps?.range).toEqual({ min: 1, max: 50, step: 1 });
  });

  it("坏形状拦截:非对象/UI 格式/缺 class_type/空图", () => {
    expect(analyzeComfyWorkflow("nope").ok).toBe(false);
    expect(analyzeComfyWorkflow({ nodes: [], links: [] }).ok).toBe(false);
    expect(analyzeComfyWorkflow({ "1": { inputs: {} } }).ok).toBe(false);
    expect(analyzeComfyWorkflow({}).ok).toBe(false);
  });

  it("analyzeComfyWorkflowText:JSON 解析错误归一成大白话 error", () => {
    expect(analyzeComfyWorkflowText("{oops").ok).toBe(false);
    const ok = analyzeComfyWorkflowText(JSON.stringify(krea2T2i));
    expect(ok.ok).toBe(true);
  });

  it("unwrapComfyApiGraph:UI 格式明确拦截并指路(不静默猜)", () => {
    const result = unwrapComfyApiGraph({ nodes: [{ type: "KSampler" }], links: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("API 格式");
  });
});

describe("detectMissingClassTypes(纯化检测)", () => {
  it("缺失=classTypesUsed−available,去重排序;全集命中为空", () => {
    expect(detectMissingClassTypes(["B", "A", "A"], new Set(["A"]))).toEqual(["B"]);
    expect(detectMissingClassTypes(["A", "B"], ["A", "B"])).toEqual([]);
    expect(detectMissingClassTypes([], [])).toEqual([]);
  });

  it("nsfw_pro 实弹:缺 ConditioningKrea2Rebalance(未装对应插件)被点名", () => {
    const result = analyzeComfyWorkflow(krea2NsfwPro);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const available = result.descriptor.classTypesUsed.filter((c) => c !== "ConditioningKrea2Rebalance");
    const missing = detectMissingClassTypes(result.descriptor.classTypesUsed, available);
    expect(missing).toEqual(["ConditioningKrea2Rebalance"]);
    expect(formatMissingClassTypesMessage(missing)).toContain("ConditioningKrea2Rebalance");
    expect(formatMissingClassTypesMessage(missing)).toContain("本地配置");
  });
});
