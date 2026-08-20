// 音乐生成 caption 专业增强(资产包:assets/minimax/music)。
// 依据 caption-rewriter-skill.md 规格做确定性合成:配方锁定风格身份,用户意图注入,
// 按词量×速度校准表(lessons.md)计算器乐填充;BGM 模式按 skill 规则声明器乐主奏。
import guofengRecipe from "@/assets/minimax/music/recipes/guofeng-yanyu-xingzhou.md?raw";

export interface MusicStyleRecipe {
  key: string;
  label: string;
  template: string;
}

/** 配方 md = 人类注释头 + caption 正文(Global Metadata 起);运行时只用正文,注释头里的占位符样例不参与替换。 */
function recipeBody(raw: string): string {
  const ix = raw.indexOf("Global Metadata");
  return ix >= 0 ? raw.slice(ix).trim() : raw.trim();
}

/** 配方索引(新增配方:recipes/ 加 md + 此处注册)。 */
export const MUSIC_STYLE_RECIPES: ReadonlyArray<MusicStyleRecipe> = [
  { key: "guofeng-yanyu-xingzhou", label: "国风·烟雨行舟系(女声空灵/笛筝主线/中速)", template: recipeBody(guofengRecipe) },
];

export const DEFAULT_MUSIC_RECIPE_KEY = "guofeng-yanyu-xingzhou";

/** lessons.md 校准表:中速≈4.3s/行,慢板≈4.9s/行(重复段边际递减已计入)。 */
export const SEC_PER_LINE = { mid: 4.3, slow: 4.9 } as const;
const INTERLUDE_SECONDS = 12;
const OUTRO_SECONDS = 10;

export type MusicCaptionMode = "bgm" | "song";

export interface BuildCaptionInput {
  /** 用户一句话描述(或已是含 Global Metadata 的专业 caption——原样放行) */
  brief: string;
  mode: MusicCaptionMode;
  recipeKey?: string;
  /** 歌词唱词行数(song 模式:据此计算器乐填充) */
  lineCount?: number;
  /** 目标秒数 */
  targetSeconds?: number;
}

export interface InstrumentalFillPlan {
  interludeS: number;
  outroS: number;
  /** 词量缺口(秒):>0 表示纯器乐也补不平,建议加词或接受短版 */
  gapS: number;
}

/** lessons.md 定律②③:时长缺口用器乐间奏/尾奏填,绝不动全局速度。 */
export function planInstrumentalFill(lineCount: number, targetSeconds: number, tempo: keyof typeof SEC_PER_LINE = "mid"): InstrumentalFillPlan {
  const sungS = lineCount * SEC_PER_LINE[tempo];
  const gap = Math.max(0, targetSeconds - sungS - OUTRO_SECONDS * 0.5);
  const interludes = Math.min(2, Math.ceil(gap / INTERLUDE_SECONDS));
  const interludeS = interludes * INTERLUDE_SECONDS;
  return { interludeS, outroS: OUTRO_SECONDS, gapS: Math.max(0, targetSeconds - sungS - interludeS - OUTRO_SECONDS) };
}

function interludeDirective(interludeS: number): string {
  if (interludeS <= 0) return "";
  // 对应歌词里「单独一行 [Intro] 标签」间奏锚点(lessons.md 间奏技巧)
  return ` Then a fully instrumental Interlude follows the second Chorus (the standalone [Intro] tag in the lyrics): the drums drop out and a solo Dizi improvises freely on the main motif for about ${Math.round(interludeS)} seconds, accompanied by Guzheng glissandi and a reverse-cymbal rise leading back in.`;
}

function outroDirective(outroS: number): string {
  return ` for about ${Math.round(outroS)} seconds`;
}

const INSTRUMENTAL_VOCAL_DETAILS =
  "Vocal Details\nThe piece is fully instrumental (no lead vocals). A solo Dizi (bamboo flute) carries the lead melodic role throughout, answered by the Guzheng in conversation; the arrangement language above otherwise applies with instruments taking the vocal phrases.";

/**
 * 生成前把一句话描述增强为结构化专业 caption。
 * - brief 已含 "Global Metadata"(用户/上层已按 skill 产出)→ 原样放行
 * - bgm 模式:Vocal Details 整体替换为器乐主奏声明(skill 规则:器乐请求保持器乐)
 */
export function buildStructuredCaption(input: BuildCaptionInput): string {
  const brief = input.brief.trim();
  if (brief.includes("Global Metadata")) return brief;
  const recipe = MUSIC_STYLE_RECIPES.find((r) => r.key === (input.recipeKey ?? DEFAULT_MUSIC_RECIPE_KEY)) ?? MUSIC_STYLE_RECIPES[0];

  const fill =
    input.mode === "song" && input.lineCount && input.targetSeconds
      ? planInstrumentalFill(input.lineCount, input.targetSeconds)
      : null;

  let caption = recipe.template
    .replace("{{BRIEF}}", brief + ".")
    .replace("{{INTERLUDE}}", fill ? interludeDirective(fill.interludeS) : interludeDirective(INTERLUDE_SECONDS))
    .replace("{{OUTRO}}", outroDirective(fill?.outroS ?? OUTRO_SECONDS));

  if (input.mode === "bgm") {
    caption = caption.replace(/Vocal Details\n[^#]*?(?=\nArrangement)/, INSTRUMENTAL_VOCAL_DETAILS + "\n");
    caption = caption.replace(/the lead enters over arpeggiated keys/g, "the Dizi lead weaves over arpeggiated keys");
    caption = caption.replace(/layered self-harmonies; the Dizi doubles the melody an octave above/, "Guzheng glissandi answering phrases");
    caption = caption.replace(/hushed, near-whisper vocal over sparse arpeggios/, "hushed, sparse Dizi and Guzheng dialogue over gentle arpeggios");
    caption = caption.replace(/the theme returns with quiet urgency as percussion rebuilds/, "the main theme returns with quiet urgency as percussion rebuilds");
    caption = caption.replace(/first harmonies, then full strings and kit, then a Dizi countermelody soaring above/, "first Guzheng answers, then full strings and kit, then a Dizi descant soaring above");
  }
  return caption;
}
