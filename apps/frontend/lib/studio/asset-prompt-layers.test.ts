import { describe, expect, it } from "vitest";

import type { AssetImageKind } from "@/types/studio-assets";
import { ASSET_IMAGE_KIND_ASPECTS } from "./asset-image-kind";
import {
  buildPromptLayerSummary,
  getPromptLayers,
  getPromptStyleBaseLayer,
  listPromptLayerKinds,
  parsePromptOverrides,
  serializePromptOverrides,
} from "./asset-prompt-layers";

/**
 * 出图提示词分层装载器测试(10-25 分层面板役 A-4):
 * - 14 型全可查(zh 名对齐键;型谱 13 名 13/13 全对齐=PRD §二 事实⑤);
 * - bases 字段锚:positive_text/negative_text/aspect_ratio/rgba_default 任一被改名
 *   即红(装载器经映射输出锚定原始字段名,PRD §九「bases 字段改名」风险对策);
 * - 折叠组摘要行格式(收起态一行:型名/画幅/rgba/字数计,§4.1 A-2)。
 */

describe("getPromptLayers · 14 型全可查(zh 名对齐键)", () => {
  it("bases 十四型(13 资产谱型+分镜剧情图)逐型可查且 zh 回显对齐", () => {
    const kinds = listPromptLayerKinds();
    expect(kinds.length).toBe(14);
    // zh 名唯一(对齐键完整性:重名会互相吞条目)
    expect(new Set(kinds).size).toBe(14);
    for (const kind of kinds) {
      const layers = getPromptLayers(kind);
      expect(layers, `bases 型「${kind}」应可查`).not.toBeNull();
      expect(layers!.type.kind).toBe(kind);
    }
  });

  it("资产型谱 13 名(排除「早期未分类」)13/13 全部有独立 bases 条目", () => {
    const spectrumKinds = Object.keys(ASSET_IMAGE_KIND_ASPECTS) as AssetImageKind[];
    expect(spectrumKinds.length).toBe(13);
    const basesKinds = new Set(listPromptLayerKinds());
    for (const kind of spectrumKinds) {
      expect(basesKinds.has(kind), `型谱「${kind}」应有 bases 条目`).toBe(true);
      expect(getPromptLayers(kind)).not.toBeNull();
    }
  });

  it("查无该型返回 null(防御位,禁编造型文)", () => {
    expect(getPromptLayers("不存在型")).toBeNull();
    expect(getPromptLayers("早期未分类")).toBeNull();
    expect(getPromptLayers("")).toBeNull();
  });
});

describe("bases 字段锚(四字段被改名即红)", () => {
  it("每型 positive_text/negative_text/aspect_ratio/rgba_default 四字段健在且类型正确", () => {
    for (const kind of listPromptLayerKinds()) {
      const { type } = getPromptLayers(kind)!;
      // positive_text 改名 → 映射落 undefined → typeof 断言红
      expect(typeof type.positiveText, `${kind}.positive_text`).toBe("string");
      // negative_text 改名 → 红
      expect(typeof type.negativeText, `${kind}.negative_text`).toBe("string");
      // aspect_ratio 改名 → 红(短值同源拆分)
      expect(typeof type.aspectRatio, `${kind}.aspect_ratio`).toBe("string");
      expect(type.aspectRatioShort).toMatch(/^\d+:\d+$/);
      // rgba_default 改名 → 红
      expect(typeof type.rgbaDefault, `${kind}.rgba_default`).toBe("boolean");
      // 自由型正向恒空属真源口径,其余型正向非空(字段被改名洗空在此显形)
      if (kind !== "自由") {
        expect(type.positiveText.length, `${kind}.positive_text 非空`).toBeGreaterThan(0);
      }
      expect(type.negativeText.length, `${kind}.negative_text 非空`).toBeGreaterThan(0);
    }
  });

  it("风格底座 art_style_base 正/负字段健在且非空(L4 层锚)", () => {
    const base = getPromptStyleBaseLayer();
    expect(typeof base.positiveText).toBe("string");
    expect(base.positiveText.length).toBeGreaterThan(0);
    expect(typeof base.negativeText).toBe("string");
    expect(base.negativeText.length).toBeGreaterThan(0);
  });

  it("正向/负向全文逐字映射(不经任何改写,只读装载)", () => {
    // 抽两型做内容透传对拍:映射值即真源字段原值(装载器零改写纪律)
    const poster = getPromptLayers("人物海报")!;
    expect(poster.type.positiveText.length).toBeGreaterThan(100);
    expect(poster.type.negativeText.length).toBeGreaterThan(10);
    expect(poster.type.purpose.length).toBeGreaterThan(0);
    // steps_hint 档在场型(自由型无此字段=null)
    expect(getPromptLayers("人物海报")!.type.stepsHint).toEqual({ fast: 4, quality: 12 });
    expect(getPromptLayers("自由")!.type.stepsHint).toBeNull();
  });
});

describe("buildPromptLayerSummary · 折叠组收起态摘要行", () => {
  it("聚焦态格式:「{型名} {画幅}{·rgba} · 底座正{N}字/负{M}字 · 型负{K}字」", () => {
    // 透明型带 ·rgba 尾段
    expect(buildPromptLayerSummary("全身定妆")).toMatch(
      /^全身定妆 \d+:\d+·rgba · 底座正\d+字\/负\d+字 · 型负\d+字$/,
    );
    // 非透明型无 ·rgba 尾段
    expect(buildPromptLayerSummary("人物海报")).toMatch(
      /^人物海报 \d+:\d+ · 底座正\d+字\/负\d+字 · 型负\d+字$/,
    );
    // 字数计与底座/型负真值同源(摘要行字段与展开内容一致,§六验收)
    const base = getPromptStyleBaseLayer();
    const summary = buildPromptLayerSummary("全身定妆")!;
    expect(summary).toContain(`底座正${base.positiveText.length}字/负${base.negativeText.length}字`);
    expect(summary).toContain(`型负${getPromptLayers("全身定妆")!.type.negativeText.length}字`);
  });

  it("查无该型降级为「该型无独立型文」;空型名返回 null(通用态由调用方自render)", () => {
    expect(buildPromptLayerSummary("不存在型")).toMatch(/^不存在型 · 该型无独立型文 · 底座正\d+字\/负\d+字$/);
    expect(buildPromptLayerSummary("")).toBeNull();
  });
});


describe("Phase C 按型主体句槽(10-25 追加令):parse/serialize", () => {
  it("parse:合法 JSON→Record;坏 JSON/非对象/空值槽→容错(空表或滤空)", () => {
    expect(parsePromptOverrides('{"设定卡":"海报构图句","美宣":"美宣主体句"}')).toEqual({
      设定卡: "海报构图句",
      美宣: "美宣主体句",
    });
    expect(parsePromptOverrides("not-json")).toEqual({});
    expect(parsePromptOverrides('["数组拒收"]')).toEqual({});
    expect(parsePromptOverrides('{"设定卡":"   "}')).toEqual({});
    expect(parsePromptOverrides(null)).toEqual({});
  });

  it("serialize:只留非空槽;round-trip 稳定", () => {
    const out = serializePromptOverrides({ 设定卡: " 句A ", 美宣: "", 道具: undefined });
    expect(JSON.parse(out)).toEqual({ 设定卡: "句A" });
    expect(parsePromptOverrides(out)).toEqual({ 设定卡: "句A" });
    expect(JSON.parse(serializePromptOverrides({}))).toEqual({});
  });
});