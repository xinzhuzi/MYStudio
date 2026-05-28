import { describe, expect, it } from "vitest";
import { VISUAL_STYLE_PRESETS } from "@/lib/constants/visual-styles";
import { DEFAULT_STYLES_PANEL_COPY } from "./DefaultStylesGrid";
import { CUSTOM_STYLES_PANEL_COPY, getCustomVisualManuals } from "./CustomStylesGrid";
import { getDefaultVisualManuals, groupDefaultVisualManuals } from "@/lib/studio/visual-manual-classification";
import type { StudioVisualManualSummary } from "@/types/studio-visual-manual";

describe("DefaultStylesGrid", () => {
  it("keeps built-in prompt presets generic and non-IP-specific", () => {
    const forbiddenTerms = [
      "Disney",
      "Pixar",
      "Ghibli",
      "Miyazaki",
      "Doraemon",
      "Dragon Ball",
      "Jojo",
      "Akira Toriyama",
      "Cartoon Network",
      "Genshin",
      "Guilty Gear",
      "Minecraft",
      "Sailor Moon",
      "Cuphead",
      "新海诚",
      "吉卜力",
      "宫崎骏",
      "鸟山明",
      "龙珠",
      "哆啦",
      "原神",
      "罪恶装备",
      "我的世界",
    ];
    const content = VISUAL_STYLE_PRESETS
      .map((style) => [style.name, style.description, style.prompt, style.negativePrompt].join("\n"))
      .join("\n");

    for (const term of forbiddenTerms) {
      expect(content, term).not.toContain(term);
    }
  });

  it("keeps internal copy and base prompt labels out of the default style copy", () => {
    const panelCopy = JSON.stringify(DEFAULT_STYLES_PANEL_COPY);

    expect(DEFAULT_STYLES_PANEL_COPY.title).toBe("默认风格");
    expect(panelCopy).not.toMatch(/基础提示词|Toonflow|skills\/art_skills|存储副本|我的新建风格|可编辑风格|道劫/);
  });

  it("keeps Daojie and user-created manuals under my styles", () => {
    const manuals = [
      makeManualSummary("2D_chinese_guofeng", true),
      makeManualSummary("daojie_ink_guofeng", true, "daojie"),
      makeManualSummary("custom_style", false),
    ];

    expect(getCustomVisualManuals(manuals).map((manual) => manual.stylePath)).toEqual([
      "daojie_ink_guofeng",
      "custom_style",
    ]);
  });

  it("shows source-backed editable manuals under default styles grouped by visual category", () => {
    const manuals = [
      makeManualSummary("2D_chinese_guofeng", true, "2d"),
      makeManualSummary("2d_ghibli", true, "2d"),
      makeManualSummary("3D_chinese_traditional", true, "3d"),
      makeManualSummary("3d_xuanhuan", true, "3d"),
      makeManualSummary("real_movie", true, "real"),
      makeManualSummary("stop_motion", true, "stop_motion"),
      makeManualSummary("daojie_ink_guofeng", true, "daojie"),
      makeManualSummary("custom_style", false, "other"),
    ];

    expect(getDefaultVisualManuals(manuals).map((manual) => manual.stylePath)).toEqual([
      "2D_chinese_guofeng",
      "2d_ghibli",
      "3D_chinese_traditional",
      "3d_xuanhuan",
      "real_movie",
      "stop_motion",
    ]);
    expect(groupDefaultVisualManuals(manuals).map((group) => [group.name, group.manuals.map((manual) => manual.stylePath)])).toEqual([
      ["2D 风格", ["2D_chinese_guofeng", "2d_ghibli"]],
      ["3D 风格", ["3D_chinese_traditional", "3d_xuanhuan"]],
      ["真人风格", ["real_movie"]],
      ["定格风格", ["stop_motion"]],
    ]);
  });

  it("presents runtime visual manuals under my styles", () => {
    const panelCopy = JSON.stringify(CUSTOM_STYLES_PANEL_COPY);

    expect(CUSTOM_STYLES_PANEL_COPY.title).toBe("我的风格");
    expect(CUSTOM_STYLES_PANEL_COPY.manualSectionTitle).toBe("本地风格");
    expect(panelCopy).toContain("skills/art_skills");
    expect(panelCopy).not.toMatch(/Toonflow|存储副本/);
  });
});

function makeManualSummary(
  stylePath: string,
  sourceExists: boolean,
  category: StudioVisualManualSummary["category"] = "other",
): StudioVisualManualSummary {
  return {
    id: stylePath,
    stylePath,
    name: stylePath,
    category,
    storagePath: `/storage/${stylePath}`,
    sourceExists,
    isCustomized: false,
    moduleCount: 1,
    imageCount: 0,
    images: [],
  };
}
