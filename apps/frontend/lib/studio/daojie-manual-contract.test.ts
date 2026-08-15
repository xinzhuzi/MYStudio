// @vitest-environment jsdom
/**
 * 道劫手册契约测试 — 保证手册(唯一真相源)与代码消费方口径一致:
 * 1. 手册内容不包含会被 sanitizeExtendedManualPrompt 改写的词(模板源头干净,sanitize 只做兜底);
 * 2. prefix.md 规定三段输出格式,与 prompt-polisher parsePolishResult 的标签对齐;
 * 3. 四视图/四宫格画幅建议与运行时支持的画幅(image-size-presets)一致;
 * 4. art_storyboard_video.md 的分镜风格标记块存在且非空(visual-manual-style-tokens fail-empty);
 * 5. ma_sync 锚点:prefix 工笔硬锁节包含全部 manualAnchor(防手改漂移);
 *    本机存在 MA 工作区时,权威文件包含全部 maAnchor(防快照过期;CI/他人机器自动跳过);
 * 6. 三轨七段公式:六本资产手册模板含公式段标记;storyboard_video 含主风格锁与通用成片负面。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTENDED_STORYBOARD_STYLE_TOKENS,
  getExtendedStoryboardStyleGuide,
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

/** sanitizeExtendedManualPrompt 的改写目标词(英文正则源 + 中文短语),手册模板不得产出这些词。 */
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
    expect(EXTENDED_STORYBOARD_STYLE_TOKENS.length).toBeGreaterThanOrEqual(3);
    expect(EXTENDED_STORYBOARD_STYLE_TOKENS.join(" ")).toContain("ink wash");
    expect(EXTENDED_STORYBOARD_STYLE_TOKENS.join(" ")).toContain("smooth pale matte flat-wash ground");
    expect(getExtendedStoryboardStyleGuide()).toContain("工笔线描");
    expect(getExtendedStoryboardStyleGuide()).toContain("浅净平涂底");
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
    expect(locked).toContain(EXTENDED_STORYBOARD_STYLE_TOKENS[0]);
    // 幂等:重复施加不重复追加
    expect(withVisualManualStoryboardStyleTokens(locked, "daojie_ink_guofeng")).toBe(locked);
    // 非道劫手册不动
    const other = withVisualManualStoryboardStyleTokens(dirty, "2D_90s_japanese_anime");
    expect(other).toBe(dirty.trim());
  });
});

describe("ma-gongbi-v1 同步守护(ma_sync 锚点)", () => {
  interface LockAnchor {
    name: string;
    manualFile: string;
    sourceIndex: number;
    manualAnchors: string[];
    maAnchors: string[];
  }
  interface LockAnchorFile {
    maSources: Array<{ path: string; sha256: string }>;
    locks: LockAnchor[];
  }

  const anchors = JSON.parse(
    readFileSync(join(DAOJIE_DIR, "ma_sync/lock-anchors.json"), "utf-8"),
  ) as LockAnchorFile;

  it("手册硬锁文本包含全部 manualAnchor(防手改漂移)", () => {
    const missing: string[] = [];
    const cache = new Map<string, string>();
    const readCached = (rel: string) => {
      if (!cache.has(rel)) cache.set(rel, readManual(rel));
      return cache.get(rel) as string;
    };
    for (const lock of anchors.locks) {
      for (const anchor of lock.manualAnchors) {
        if (!readCached(lock.manualFile).includes(anchor)) missing.push(`[${lock.name}] ${anchor}`);
      }
    }
    expect(missing, `手册硬锁与 ma_sync 锚点漂移: ${missing.join("; ")}`).toEqual([]);
  });

  it("十把硬锁齐备(底座/结构/身份/衣褶/衣物/头发/鞋靴/成片/主风格/成片负面)", () => {
    expect(anchors.locks.map((lock) => lock.name)).toEqual([
      "风格底座锁",
      "工笔结构锁",
      "身份一致性锁",
      "衣褶裙摆锁",
      "衣物完整锁",
      "头发存在锁",
      "鞋靴性别锁",
      "成片质量锁",
      "成片主风格锁",
      "通用成片负面",
    ]);
  });

  const maWorkspacePresent = existsSync(anchors.maSources[0].path);
  (maWorkspacePresent ? it : it.skip)("本机 MA 权威文件包含全部 maAnchor(防快照过期)", () => {
    const missing: string[] = [];
    const sources = anchors.maSources.map((source) => readFileSync(source.path, "utf-8"));
    for (const lock of anchors.locks) {
      const content = sources[lock.sourceIndex];
      for (const anchor of lock.maAnchors) {
        if (!content.includes(anchor)) missing.push(`[${lock.name}] ${anchor}`);
      }
    }
    expect(missing, `MA 权威文件与 ma_sync 锚点漂移(需更新快照): ${missing.join("; ")}`).toEqual([]);
  });

  it("本机 MA 不存在时直连比对跳过(CI 安全)", () => {
    // 显式记录行为:目录不存在 → 上一直连用例被 it.skip;此处断言守卫逻辑本身可用
    expect(typeof maWorkspacePresent).toBe("boolean");
  });
});

describe("三轨七段公式(ma-gongbi-v1 题材正文公式)", () => {
  const formulaFiles: Array<[string, string[]]> = [
    ["art_prompt/art_character.md", ["身份形体", "构图", "Negative Prompt"]],
    ["art_prompt/art_character_derivative.md", ["身份形体", "构图", "Negative Prompt", "单一变化轴"]],
    ["art_prompt/art_scene.md", ["前中远景", "视角光线", "Negative Prompt"]],
    ["art_prompt/art_scene_derivative.md", ["前中远景", "视角光线", "Negative Prompt", "单一变化轴"]],
    ["art_prompt/art_prop.md", ["形制结构", "透视", "Negative Prompt"]],
    ["art_prompt/art_prop_derivative.md", ["形制结构", "透视", "Negative Prompt", "单一变化轴"]],
  ];

  it.each(formulaFiles)("公式化模板含必备段: %s", (rel, markers) => {
    const manual = readManual(rel);
    for (const marker of markers) {
      expect(manual, `${rel} 缺公式段标记「${marker}」`).toContain(marker);
    }
  });

  it("六本模板均声明「不抄写自动层」", () => {
    for (const [rel] of formulaFiles) {
      expect(readManual(rel), `${rel} 缺自动层边界声明`).toMatch(/自动层|硬锁.*不重复|不抄写/);
    }
  });
});

describe("成片模板库(art_storyboard_video)", () => {
  it("含《道劫》主风格锁与通用成片负面关键句", () => {
    const manual = readManual("art_prompt/art_storyboard_video.md");
    expect(manual).toContain("《道劫》默认主风格");
    expect(manual).toContain("工笔结构层");
    expect(manual).toContain("写意气韵层");
    expect(manual).toContain("通用成片负面");
    expect(manual).toContain("不要伪字题跋");
  });

  it("成片模板速查覆盖 12 个漫剧相关模板", () => {
    const manual = readManual("art_prompt/art_storyboard_video.md");
    const templates = ["03", "07", "21", "26", "24", "25", "02", "09", "13", "30", "31", "28"];
    const missing = templates.filter((id) => !new RegExp(`### ${id}\\.`).test(manual));
    expect(missing, `缺少成片模板: ${missing.join("/")}`).toEqual([]);
  });
});
