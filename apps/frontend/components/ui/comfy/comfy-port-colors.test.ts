// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 八类核心端口 + 未知类型兜底(纯函数层,默认 node 环境即可)
import { describe, expect, it } from "vitest";
import {
  COMFY_PORT_COLOR_SPECS,
  COMFY_PORT_CSS_VARIABLES,
  COMFY_PORT_UNKNOWN_SPEC,
  comfyPortCssColor,
  comfyPortTypeLabel,
  getComfyPortColorSpec,
} from "./comfy-port-colors";

const EXPECTED_TYPES = [
  "IMAGE",
  "LATENT",
  "MODEL",
  "CLIP",
  "VAE",
  "CONDITIONING",
  "STRING",
  "MASK",
] as const;

describe("ComfyUI 端口配色常量表(prd 裁定 6:色相沿社区惯例,数值自选)", () => {
  it("八类核心端口全映射,各带中文名/CSS 变量/兜底色", () => {
    for (const type of EXPECTED_TYPES) {
      const spec = COMFY_PORT_COLOR_SPECS[type];
      expect(spec, `${type} 必须有条目`).toBeTruthy();
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.cssVar).toMatch(/^--comfy-port-[a-z-]+$/);
      expect(spec.fallback).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("cssColor 输出 var(--x, #hex) 双形式(主题可覆盖+兜底可用)", () => {
    const css = comfyPortCssColor("IMAGE");
    expect(css).toBe("var(--comfy-port-image, #7C6CF0)");
  });

  it("查表大小写不敏感;未知/空类型回落中性灰", () => {
    expect(getComfyPortColorSpec("image").type).toBe("IMAGE");
    expect(getComfyPortColorSpec("Image").label).toBe("图像");
    expect(getComfyPortColorSpec("SOMETHING_CUSTOM")).toBe(COMFY_PORT_UNKNOWN_SPEC);
    expect(getComfyPortColorSpec("  ")).toBe(COMFY_PORT_UNKNOWN_SPEC);
  });

  it("CSS 变量全表含八类+未知兜底,值与常量表一致", () => {
    for (const type of EXPECTED_TYPES) {
      expect(COMFY_PORT_CSS_VARIABLES[COMFY_PORT_COLOR_SPECS[type].cssVar]).toBe(
        COMFY_PORT_COLOR_SPECS[type].fallback,
      );
    }
    expect(COMFY_PORT_CSS_VARIABLES[COMFY_PORT_UNKNOWN_SPEC.cssVar]).toBe(
      COMFY_PORT_UNKNOWN_SPEC.fallback,
    );
  });

  it("中文语义名:已知类型有名字,空类型给空串", () => {
    expect(comfyPortTypeLabel("MASK")).toBe("蒙版");
    expect(comfyPortTypeLabel("CONDITIONING")).toBe("条件");
    expect(comfyPortTypeLabel("")).toBe("");
  });
});
