/**
 * 原著圣经（sourceBible）——项目级常驻书级上下文。
 *
 * 设计对齐 NousResearch/hermes-agent 第一层记忆（MEMORY.md）思想：
 * 精炼、硬上限、每次 AI 调用无条件注入、超限拒绝而非静默截断。
 * 与「剧集圣经」（seriesBible，制作侧视觉锁定）成对：一本管书，一本拍戏。
 */
import type { NovelChapter } from "@/types/studio";
import { parseStageOutput } from "./script-planning";

/** 硬上限（Hermes 原则：宁可报错不让用户无意间膨胀到挤占每次调用的上下文）。
 *  4000：容纳 72 人全阵容时人均 ~30 字的「身份弧线」描述；≈2k token/次注入，相对章节正文可接受。 */
export const SOURCE_BIBLE_MAX_CHARS = 4000;

/** 五段固定模板——格式即契约，主要人物行格式供机器解析做人物名校验。 */
export const SOURCE_BIBLE_TEMPLATE = `# 原著圣经

## 一句话主线
（本书真正的故事主线——事件分析判定「主线关系」强/中/弱的唯一依据）

## 题材与基调
（题材、整体基调、目标风格）

## 主要人物
- 规范名（别名1、别名2）：身份/立场一句话

## 世界观铁律
（力量体系、核心设定等不可违背的事实）

## 改编红线
（改编时绝不可违背/绝不可剧透的内容）
`;

const SOURCE_BIBLE_PRIORITY_HEADER =
  "# 原著圣经（最高优先级·人物一律用此表规范名·主线判定以此为准·与正文冲突时事实以正文为准）";

/** 注入用包装：剥模板自身 H1，换固定优先级声明头；空文本返回空串（空圣经零影响）。 */
export function formatSourceBibleContext(markdown: string): string {
  const text = markdown.trim();
  if (!text) return "";
  const body = text.replace(/^#\s*原著圣经[^\n]*\n/, "").trim();
  return `${SOURCE_BIBLE_PRIORITY_HEADER}\n\n${body}`;
}

/** 五个必需二级标题——AI 生成与解析的格式契约（注入侧对用户手改保持宽容）。 */
export const SOURCE_BIBLE_REQUIRED_SECTIONS = [
  "一句话主线",
  "题材与基调",
  "主要人物",
  "世界观铁律",
  "改编红线",
] as const;

export interface SampledChapter {
  index: number;
  title: string;
  excerpt: string;
}

/**
 * 头/中/尾确定性采样：首 2 章与末 2 章必含，中间等距步进，总字符量受预算约束。
 * 圣经不依赖事件分析产出，第一次批量分析前即可生成（避开鸡生蛋）。
 */
export function sampleChaptersForBible(
  chapters: NovelChapter[],
  options?: { budgetChars?: number; perChapterChars?: number },
): SampledChapter[] {
  const budget = options?.budgetChars ?? 24000;
  const perChapter = options?.perChapterChars ?? 3000;
  const sorted = [...chapters].sort((left, right) => left.index - right.index);
  if (!sorted.length) return [];

  const excerptOf = (chapter: NovelChapter): string => {
    const text = chapter.sourceText.trim();
    return text.length > perChapter ? `${text.slice(0, perChapter)}\n…（截断）` : text;
  };
  const totalChars = sorted.reduce(
    (sum, chapter) => sum + Math.min(chapter.sourceText.trim().length, perChapter),
    0,
  );
  if (totalChars <= budget) {
    return sorted.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      excerpt: excerptOf(chapter),
    }));
  }

  const picked = new Set<NovelChapter>();
  const push = (chapter?: NovelChapter) => {
    if (chapter) picked.add(chapter);
  };
  push(sorted[0]);
  push(sorted[1]);
  push(sorted[sorted.length - 1]);
  push(sorted[sorted.length - 2]);
  const middle = sorted.slice(2, -2);
  const slots = Math.max(1, Math.floor(budget / perChapter) - 4);
  const step = Math.max(1, Math.ceil(middle.length / slots));
  for (let i = 0; i < middle.length; i += step) {
    push(middle[i]);
  }

  const result: SampledChapter[] = [];
  let used = 0;
  for (const chapter of sorted) {
    if (!picked.has(chapter)) continue;
    const excerpt = excerptOf(chapter);
    if (used + excerpt.length > budget && result.length >= 2) break;
    used += excerpt.length;
    result.push({ index: chapter.index, title: chapter.title, excerpt });
  }
  return result;
}

const sourceBibleGenerationPrompt = `# 原著圣经生成指令

你是小说改编策划。用户会提供一本书的章节采样（头/中/尾），你据此为整本书生成「原著圣经」设定卡，供后续所有 AI 改编阶段作为最高优先级上下文。

## ⚠️ 输出约束（最高优先级，违反任何一条即为失败）

1. 第一行固定为 \`# 原著圣经\`，除此之外不得出现任何一级标题
2. 严格按五个二级标题输出，标题文字一字不差：\`## 一句话主线\`、\`## 题材与基调\`、\`## 主要人物\`、\`## 世界观铁律\`、\`## 改编红线\`
3. 主要人物每行格式：\`- 规范名（别名1、别名2）：身份/立场一句话\`；没有别名就省略括号；选 6-12 个真正推动剧情的人物
4. 总输出不超过 ${SOURCE_BIBLE_MAX_CHARS} 字符（含标点与空白）；「一句话主线」不超过 60 字
5. 只基于采样正文归纳，不编造原文没有的人物与设定；采样未覆盖的部分宁缺毋滥
6. 直接输出正文，不要代码围栏、不要寒暄、不要解释、不要输出示例

## 各段要点

- 一句话主线：贯穿全书的核心冲突/目标与走向，是「主线关系」强/中/弱判定的唯一依据
- 题材与基调：题材标签 + 整体基调（如「都市修仙，爽感+悬念，基调偏热血」）
- 世界观铁律：力量体系/核心规则等改编时不可违背的事实
- 改编红线：绝不可违背的设定、绝不可提前剧透的悬念`.trim();

export interface SourceBibleMessages {
  system: string;
  user: string;
}

export function buildSourceBibleMessages(input: {
  projectName: string;
  genre?: string;
  sampledChapters: SampledChapter[];
}): SourceBibleMessages {
  const lines: string[] = [];
  lines.push(`## 书名\n${input.projectName || "未命名作品"}`);
  lines.push(`## 题材参考\n${input.genre?.trim() || "未指定（从正文自行判断）"}`);
  lines.push("## 章节采样（头/中/尾，用于推断全书设定）");
  for (const chapter of input.sampledChapters) {
    lines.push(`### ${chapter.title}\n${chapter.excerpt}`);
  }
  return { system: sourceBibleGenerationPrompt, user: lines.join("\n\n") };
}

/** 解析 AI 生成的圣经草稿：剥 think/围栏后校验五个必需段落，缺任一则拒收。 */
export function parseSourceBibleDraft(output: string): string {
  const text = parseStageOutput(output);
  const missing = SOURCE_BIBLE_REQUIRED_SECTIONS.filter(
    (section) => !text.includes(`## ${section}`),
  );
  if (missing.length) {
    throw new Error(`原著圣经草稿缺少必需段落：${missing.join("、")}`);
  }
  if (text.length > SOURCE_BIBLE_MAX_CHARS) {
    throw new Error(
      `原著圣经草稿超过 ${SOURCE_BIBLE_MAX_CHARS} 字符上限（当前 ${text.length}），请精简`,
    );
  }
  return text;
}

export interface BibleCharacter {
  name: string;
  aliases: string[];
}

/** 解析「## 主要人物」下的 `- 规范名（别名）：描述` 行（对用户手改宽容，容忍缺冒号行）。 */
export function parseBibleCharacters(markdown: string): BibleCharacter[] {
  const section = markdown.split(/^##\s*主要人物\s*$/m)[1];
  if (!section) return [];
  const sectionBody = section.split(/^##\s/m)[0];
  const characters: BibleCharacter[] = [];
  for (const rawLine of sectionBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("-") && !line.startsWith("*")) continue;
    const body = line.replace(/^[-*]\s*/, "");
    const match = body.match(/^([^：:（(]+?)(?:[（(]([^）)]*)[）)])?\s*[：:]/);
    if (!match?.[1]?.trim()) continue;
    characters.push({
      name: match[1].trim(),
      aliases: (match[2] ?? "")
        .split(/[、,，/]+/)
        .map((alias) => alias.trim())
        .filter(Boolean),
    });
  }
  return characters;
}

/** 人物名机器校验：未登记（不在规范名/别名表内）的提取名列表；圣经无人物表时返回空（零误报）。 */
export function validateCharactersAgainstBible(
  characters: string[],
  bibleCharacters: BibleCharacter[],
): string[] {
  if (!bibleCharacters.length) return [];
  const registered = new Set<string>();
  for (const entry of bibleCharacters) {
    registered.add(entry.name);
    for (const alias of entry.aliases) {
      registered.add(alias);
    }
  }
  return characters.filter((name) => !registered.has(name.trim()));
}
