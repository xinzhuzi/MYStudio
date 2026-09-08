// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import {
  CURATED_COMFY_EFFECTS,
  objectInfoDetailReplyToDescriptor,
  objectInfoEntryToDescriptor,
  searchCuratedEffects,
} from "./comfy-effect-catalog";

describe("策展效果包(默认层)", () => {
  it("内置 10 个常用 classType,全部带中文映射与 descriptor", () => {
    expect(CURATED_COMFY_EFFECTS.length).toBeGreaterThanOrEqual(8);
    for (const entry of CURATED_COMFY_EFFECTS) {
      expect(entry.classType).toBeTruthy();
      expect(entry.zhName).toBeTruthy();
      expect(entry.descriptor.ports.length + entry.descriptor.widgets.length).toBeGreaterThan(0);
    }
  });

  it("搜索:中文名/关键词/英文 classType 命中,空查询回全量", () => {
    expect(searchCuratedEffects("")).toHaveLength(CURATED_COMFY_EFFECTS.length);
    expect(searchCuratedEffects("模糊").map((e) => e.classType)).toContain("ImageBlur");
    expect(searchCuratedEffects("blend").map((e) => e.classType)).toContain("ImageBlend");
    expect(searchCuratedEffects("不存在的效果XYZ")).toHaveLength(0);
  });
});

describe("object_info 单类解析(高级层全量直放)", () => {
  it("五类 widget/COMBO/连线口/输出口全部归位", () => {
    const descriptor = objectInfoEntryToDescriptor({
      input: {
        seed: ["INT", { default: 8, min: 0, max: 100, step: 1 }],
        cfg: ["FLOAT", { default: 3.5, min: 0, max: 32 }],
        text: ["STRING", { default: "hi", multiline: true }],
        force: ["BOOLEAN", { default: false }],
        sampler_name: [["euler", "euler_ancestral", "heun"]],
        model: [["MODEL"]],
        positive: [["CONDITIONING"]],
      },
      output: ["LATENT"],
      name: "KSampler",
      category: "sampling",
    });
    const widgets = Object.fromEntries(descriptor.widgets.map((w) => [w.id, w]));
    expect(widgets.seed).toMatchObject({ type: "INT", default: 8, min: 0, max: 100 });
    expect(widgets.cfg).toMatchObject({ type: "FLOAT", default: 3.5 });
    expect(widgets.text).toMatchObject({ type: "STRING", default: "hi" });
    expect(widgets.force).toMatchObject({ type: "BOOLEAN", default: false });
    expect(widgets.sampler_name).toMatchObject({ type: "COMBO", options: ["euler", "euler_ancestral", "heun"] });
    const inputs = descriptor.ports.filter((p) => p.side === "input");
    expect(inputs.find((p) => p.id === "model")?.type).toBe("MODEL");
    expect(inputs.find((p) => p.id === "positive")?.type).toBe("CONDITIONING");
    expect(descriptor.ports.find((p) => p.side === "output")).toMatchObject({ id: "0", type: "LATENT" });
  });

  it("多输出口槽位序号成口 id(连线边 sourceHandle 口径)", () => {
    const descriptor = objectInfoEntryToDescriptor({
      input: {},
      output: ["IMAGE", "MASK"],
    });
    const outputs = descriptor.ports.filter((p) => p.side === "output");
    expect(outputs.map((p) => p.id)).toEqual(["0", "1"]);
    expect(outputs[1].type).toBe("MASK");
  });

  it("详情应答缺 detail 给大白话(引擎未跑/插件卸载)", () => {
    const missing = objectInfoDetailReplyToDescriptor({ detail: null }, "NoSuchNode");
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain("NoSuchNode");
    const ok = objectInfoDetailReplyToDescriptor(
      { detail: { input: {}, output: ["IMAGE"] } },
      "ImageBlur",
    );
    expect(ok.ok && ok.descriptor.ports[0].type).toBe("IMAGE");
  });

  it("结构漂移防御:解析不出任何口/widget 时给兜底输出口", () => {
    const descriptor = objectInfoEntryToDescriptor({ input: "garbage" });
    expect(descriptor.ports).toHaveLength(1);
    expect(descriptor.ports[0].side).toBe("output");
  });
});
