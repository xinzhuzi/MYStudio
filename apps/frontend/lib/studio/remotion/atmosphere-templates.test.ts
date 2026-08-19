import { describe, expect, it } from "vitest";
import {
  ATMOSPHERE_TEMPLATES,
  atmosphereTemplatePhase,
  getAtmosphereTemplate,
  isAtmosphereTemplateId,
} from "./atmosphere-templates";

describe("atmosphere-templates 闭集(08-19 multilayer Child2)", () => {
  it("≥8 条全程序化(雾带族+粒子族),id 唯一且带 atmo: 命名空间", () => {
    expect(ATMOSPHERE_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    const ids = ATMOSPHERE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("atmo:")).toBe(true);
  });

  it("语义标注含情绪+场景(description=AI 选层参考,同 LUT 喂法)", () => {
    for (const template of ATMOSPHERE_TEMPLATES) {
      expect(template.description).toMatch(/——.*,情绪/);
      expect(template.description.length).toBeGreaterThan(12);
    }
  });

  it("每条有渲染缺省参数(fog=雾带族 particles=粒子族)", () => {
    for (const template of ATMOSPHERE_TEMPLATES) {
      expect(Object.keys(template.defaults).length).toBeGreaterThan(0);
      if (template.kind === "particles") {
        expect(template.defaults.count).toBeGreaterThan(0);
        expect(template.defaults.seed).toBeGreaterThan(0);
      } else {
        expect(template.defaults.opacity).toBeGreaterThan(0);
      }
    }
  });

  it("闭集校验与查询", () => {
    expect(isAtmosphereTemplateId("atmo:fog-band")).toBe(true);
    expect(isAtmosphereTemplateId("atmo:bogus")).toBe(false);
    expect(isAtmosphereTemplateId(42)).toBe(false);
    expect(getAtmosphereTemplate("atmo:embers").kind).toBe("particles");
    expect(getAtmosphereTemplate("atmo:mist-veil").kind).toBe("fog");
  });

  it("phase 派生确定性且非全 0(防相邻镜同相前科)", () => {
    for (const template of ATMOSPHERE_TEMPLATES) {
      const phase = atmosphereTemplatePhase(template.id);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
      expect(atmosphereTemplatePhase(template.id)).toBe(phase);
    }
    const phases = new Set(ATMOSPHERE_TEMPLATES.map((template) => atmosphereTemplatePhase(template.id)));
    expect(phases.size).toBeGreaterThan(1);
  });
});
