// @vitest-environment jsdom
/**
 * 道劫手册契约测试 — 保证手册(唯一真相源)与代码消费方口径一致:
 * 1. 手册内容不包含会被 sanitizeDaojiePrompt 改写的词(模板源头干净,sanitize 只做兜底);
 * 2. prefix.md 规定三段输出格式,与 prompt-polisher parsePolishResult 的标签对齐;
 * 3. 四视图/四宫格画幅建议与运行时支持的画幅(image-size-presets)一致;
 * 4. art_storyboard_video.md 的分镜风格标记块存在且非空(visual-manual-style-tokens fail-empty)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAOJIE_STORYBOARD_STYLE_TOKENS,
  getDaojieStoryboardStyleGuide,
  withVisualManualStoryboardStyleTokens,
} from "./visual-manual-style-tokens";

const DAOJIE_DIR = join(
  process.cwd(),
  "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng",
);

const MANUAL_FILES = [
  "README.md",
  "prefix.md",
  "art_prompt/art_character.md",
  "art_prompt/art_character_derivative.md",
  "art_prompt/art_scene.md",
  "art_prompt/art_scene_derivative.md",
  "art_prompt/art_prop.md",
  "art_prompt/art_prop_derivative.md",
  "art_prompt/art_storyboard_video.md",
  "driector_skills/director_planning_style.md",
  "driector_skills/director_storyboard.md",
  "driector_skills/director_storyboard_table_style.md",
] as const;

function readManual(rel: string): string {
  return readFileSync(join(DAOJIE_DIR, rel), "utf-8");
}

/** sanitizeDaojiePrompt 的改写目标词(英文正则源 + 中文短语),手册模板不得产出这些词。 */
const SANITIZE_TARGET_WORDS = [
  "cinematic lighting",
  "cinematic composition",
  "cinematic quality",
  "cinematic atmosphere",
  "cinematic motion",
  "volumetric fog",
  "volumetric light",
  "depth of field",
  "film grain",
  "HDR highlight",
  "muted cyan-green",
  "low-saturation cyan-green",
  "电影级光影",
  "电影质感",
  "电影构图",
  "体积雾",
  "浅景深",
  "景深虚化",
  "胶片颗粒",
  "8K，超保真",
  // 纸面口径(对齐 MA ma-gongbi-v1):纸纹是缺陷,纸面写浅净平涂底
  "rice paper texture",
  "xuan paper texture",
  "clean paper texture",
  "宣纸质感",
  "宣纸肌理",
];

/** 规则语境行(定义禁令/改写口径的行)允许出现这些词。 */
const RULE_CONTEXT = /(禁|不得|不写|一律改写|改写|替代|覆盖|→|等效|例外|列入负面|赞美词|fail-empty|标记块)/;

describe("道劫手册契约", () => {
  it.each(MANUAL_FILES)("模板不含 sanitize 改写目标词: %s", (rel) => {
    const lines = readManual(rel).split(/\r?\n/);
    const violations = lines
      .map((line, index) => ({ line: line.toLowerCase(), raw: lines[index], number: index + 1 }))
      .filter(
        ({ line, raw }) =>
          SANITIZE_TARGET_WORDS.some((word) => line.includes(word.toLowerCase()))
          && !RULE_CONTEXT.test(raw),
      );
    expect(
      violations.map(({ number, raw }) => `${rel}:${number}: ${raw.trim()}`),
      "手册出现 sanitize 改写目标词且不在规则语境 — 应改用等效水墨表达",
    ).toEqual([]);
  });

  it("prefix.md 规定三段输出格式(中文描述/Negative Prompt 标签)", () => {
    const prefix = readManual("prefix.md");
    expect(prefix).toMatch(/中文描述[：:]/);
    expect(prefix).toMatch(/Negative Prompt[：:]/);
    expect(prefix).toMatch(/负面提示词|Negative Prompt 段/);
  });

  it("四视图画幅为运行时支持的 21:9,四宫格为 1:1", () => {
    const character = readManual("art_prompt/art_character.md");
    const characterDerivative = readManual("art_prompt/art_character_derivative.md");
    const prop = readManual("art_prompt/art_prop.md");
    expect(character).toContain("21:9");
    expect(characterDerivative).toContain("21:9");
    expect(character).not.toMatch(/[43]:1/);
    expect(characterDerivative).not.toMatch(/[43]:1/);
    expect(prop).toContain("1:1");
  });

  it("分镜风格标记块存在且非空(fail-empty 不触发)", () => {
    expect(DAOJIE_STORYBOARD_STYLE_TOKENS.length).toBeGreaterThanOrEqual(3);
    expect(DAOJIE_STORYBOARD_STYLE_TOKENS.join(" ")).toContain("ink wash");
    expect(DAOJIE_STORYBOARD_STYLE_TOKENS.join(" ")).toContain("smooth pale matte flat-wash ground");
    expect(getDaojieStoryboardStyleGuide()).toContain("工笔线描");
    expect(getDaojieStoryboardStyleGuide()).toContain("浅净平涂底");
  });

  it("风格锁:道劫先 sanitize 再追加 token,幂等;非道劫原样返回", () => {
    const dirty = "山巅斗法, cinematic lighting, shallow depth of field, 电影质感, 宣纸质感, rice paper texture";
    const locked = withVisualManualStoryboardStyleTokens(dirty, "daojie_ink_guofeng");
    expect(locked).not.toContain("cinematic lighting");
    expect(locked).not.toContain("depth of field");
    expect(locked).not.toContain("电影质感");
    expect(locked).not.toContain("宣纸质感");
    expect(locked).not.toContain("rice paper texture");
    expect(locked).toContain("浅净平涂底");
    expect(locked).toContain(DAOJIE_STORYBOARD_STYLE_TOKENS[0]);
    // 幂等:重复施加不重复追加
    expect(withVisualManualStoryboardStyleTokens(locked, "daojie_ink_guofeng")).toBe(locked);
    // 非道劫手册不动
    const other = withVisualManualStoryboardStyleTokens(dirty, "2D_90s_japanese_anime");
    expect(other).toBe(dirty.trim());
  });
});
