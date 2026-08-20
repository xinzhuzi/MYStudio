// 一键成曲·LLM 写词(08-20-one-click-song)。
// 硬约束来自 assets/minimax/music/lessons.md 的四代返工教训:
// ①行数=时长÷4.3s(词短→即兴补词,词长→截尾)②五标签白名单且独占一行 ③风格气质由配方锁。
import { SEC_PER_LINE } from "./music-caption";

export const LYRIC_SECTION_TAGS = ["Intro", "Verse", "Chorus", "Bridge", "Outro"] as const;
export type LyricSectionTag = (typeof LYRIC_SECTION_TAGS)[number];

/** 目标唱词行数(中速校准,±10% 交给 LLM 弹性)。 */
export function targetLineCount(seconds: number): number {
  return Math.max(4, Math.round(seconds / SEC_PER_LINE.mid));
}

/** 按时长推荐段序(结构模板;LLM 可微调但行数优先)。 */
export function recommendedStructure(seconds: number): string {
  if (seconds < 60) return "[Intro] → [Verse] → [Chorus]";
  if (seconds < 120) return "[Intro] → [Verse] → [Chorus] → [Verse] → [Chorus] → [Outro]";
  if (seconds < 180) return "[Intro] → [Verse] → [Chorus] → [Verse] → [Chorus] → [Bridge] → [Chorus] → [Outro]";
  return "[Intro] → [Verse] → [Verse] → [Chorus] → [Verse] → [Chorus] → [Bridge] → [Verse](再现) → [Chorus]×2 → [Outro]";
}

export interface LyricRequestInput {
  /** 创作主题(必填),如「《道劫》片头曲:少年血仇逆天」 */
  theme: string;
  /** 参考材料(可选):设定集摘录/原著圣经/既有词 */
  reference?: string;
  /** 风格气质描述(来自所选配方) */
  styleLabel: string;
  /** 目标秒数(表单时长) */
  targetSeconds: number;
}

export interface LyricMessages {
  system: string;
  user: string;
}

export function buildLyricMessages(input: LyricRequestInput): LyricMessages {
  const lines = targetLineCount(input.targetSeconds);
  const reference = (input.reference ?? "").trim().slice(0, 6000);
  const system = [
    "你是一位专业中文歌词作者,为 AI 音乐引擎(MiniMax-Music3)创作歌词。",
    `作品风格气质:${input.styleLabel}。用词、意象、情绪须贴合该气质。`,
    "输出契约(必须严格遵守):",
    "1. 只输出歌词正文,不要标题、不要解说、不要 markdown 围栏;",
    "2. 段落标签只用这五个且必须独占一行:[Intro] [Verse] [Chorus] [Bridge] [Outro],标签后的同行文字会被引擎丢弃;",
    "3. 中文为主,每行一句,长短句交错但单行不超过 14 字为宜(便于演唱);",
    "4. 空行用于分隔段落。",
  ].join("\n");
  const user = [
    `创作主题:${input.theme}`,
    reference ? `参考材料(设定/世界观/既有词,术语与事实以此为准):\n${reference}` : "",
    `结构建议(可微调,但总行数优先):${recommendedStructure(input.targetSeconds)}`,
    `硬性目标:唱词总行数(不含标签行/空行)约 ${Math.round(lines * 0.9)} ~ ${Math.round(lines * 1.1)} 行(当前目标 ${lines} 行)——`,
    "行数过多会被截尾,过少引擎会即兴编词补位,请以行数为第一约束。",
    "现在输出歌词:",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

export interface ParsedLyrics {
  lyrics: string;
  warnings: string[];
}

/** 解析 LLM 草稿:剥围栏/解说,校验标签与行数;尽力回填,问题走 warnings。 */
export function parseLyricsDraft(raw: string, targetSeconds: number): ParsedLyrics {
  const warnings: string[] = [];
  let text = raw.trim();
  // 剥 markdown 围栏(任意位置:模型常先寒暄再围栏)
  text = text.replace(/^```[a-zA-Z]*\s*\n?/gm, "").replace(/^```\s*$/gm, "").trim();
  // 非法标签检查须在切片前(切片会丢弃首个合法标签前的内容,含非法标签行)
  {
    const anyTag = /^\[(.+)\]\s*$/gm;
    for (const match of text.matchAll(anyTag)) {
      if (!LYRIC_SECTION_TAGS.includes(match[1] as LyricSectionTag)) {
        warnings.push(`非标准标签 [${match[1]}] 会被引擎忽略,建议改为五标准集之一`);
      }
    }
  }
  // 剥前后解说行:从首个标签行起,到最后一个标签段的末尾
  const tagLine = /^\[(Intro|Verse|Chorus|Bridge|Outro)\]\s*$/gm;
  const first = text.search(tagLine);
  if (first >= 0) {
    const matches = [...text.matchAll(tagLine)];
    const lastTag = matches[matches.length - 1];
    const lastEnd = (lastTag.index ?? 0) + (lastTag[0]?.length ?? 0);
    const tail = text.slice(lastEnd);
    const tailLines = tail.split("\n").filter((l) => l.trim());
    text = text.slice(first, lastEnd) + (tailLines.length ? "\n" + tailLines.join("\n") : "");
  } else {
    warnings.push("未检测到任何段落标签,已原样回填——请手动补 [Intro]/[Verse]/[Chorus] 等标签(独占一行)");
  }
  // 行数校准
  const sung = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("[")).length;
  const target = targetLineCount(targetSeconds);
  if (sung === 0) {
    warnings.push("草稿没有唱词行");
  } else if (Math.abs(sung - target) / target > 0.25) {
    warnings.push(`唱词 ${sung} 行,目标 ${target} 行(偏差>25%)——过短引擎会即兴补词,过长会截尾,建议增删`);
  }
  return { lyrics: text, warnings };
}
