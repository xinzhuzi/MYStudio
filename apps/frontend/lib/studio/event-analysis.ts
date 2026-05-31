import type { NovelChapter, NovelEventAnalysis } from "@/types/studio";

const eventExtractionPrompt = `
# 事件提取指令

你是小说文本分析助手。用户每次提供一个章节的原文，你提取该章的结构化事件信息。

## ⚠️ 输出约束（最高优先级，违反任何一条即为失败）

1. 你的**完整回复**只有一行，以 \`|\` 开头、以 \`|\` 结尾，恰好 7 个字段
2. 回复的**第一个字符**必须是 \`|\`，**最后一个字符**必须是 \`|\`
3. \`|\` 之前不许有任何字符——没有引导语、没有解释、没有"根据……"、没有"以下是……"
4. \`|\` 之后不许有任何字符——没有总结、没有提取说明、没有改编建议
5. 不输出表头行、分隔线、Markdown 标题、emoji、代码块标记

## 输出格式

| 第X章 {章节标题} | {涉及角色} | {核心事件} | {主线关系} | {信息密度} | {预估集长} | {情绪强度} |

### 字段规范

- 章节：\`第X章 {章节标题}\`，示例 \`第1章 职业危机与许愿\`
- 涉及角色：有实际戏份的角色，顿号分隔，示例 \`林逸、白有容\`
- 核心事件：30-60字，必须含动作+结果
- 主线关系：**必须**为 \`强/中/弱（3-8字理由）\`，示例 \`强（动机建立+系统激活）\`
- 信息密度：\`高\` / \`中\` / \`低\`
- 预估集长：**必须**为 \`X秒\`，禁止用分钟
- 情绪强度：文字标签，\`+\` 连接，禁止星级/数字，示例 \`转折+悬疑\`

**主线关系判定**：强＝直接推动主角弧线；中＝补充世界观/人物关系/伏笔；弱＝过渡/气氛。

**预估集长参考**：高密度+高情绪→45-60秒；中→35-45秒；低→25-35秒。

**可用情绪标签**：冲突、恐怖、情感、转折、高潮、平铺、喜剧、悬疑、情感崩溃。

## 提取规则

- 忠于原文，不推测、不脑补、不加入原文未出现的情节
- 角色使用文中主要称呼，保持一致
- 多条平行事件线时，选对主角影响最大的一条，其余简要带过
- 对话密集章节，关注对话推动了什么结果，而非复述对话内容
`.trim();

export interface NovelEventAnalysisMessages {
  system: string;
  user: string;
}

export function buildNovelEventAnalysisMessages(chapter: NovelChapter): NovelEventAnalysisMessages {
  return {
    system: eventExtractionPrompt,
    user: [
      `请根据以下小说章节数：${chapter.index}`,
      `小说章节卷：${chapter.volume ?? "正文卷"}`,
      `小说章节名称：${chapter.title}`,
      "小说章节内容生成事件摘要：",
      chapter.sourceText,
    ].join("\n"),
  };
}

export function parseNovelEventAnalysisLine(output: string): NovelEventAnalysis {
  const rawLine = extractEventLine(output);
  const fields = rawLine
    .slice(1, -1)
    .split("|")
    .map((item) => item.trim());

  if (fields.length !== 7 || fields.some((field) => !field)) {
    throw new Error("事件分析结果格式不正确，应为 7 字段表格行");
  }

  return {
    chapterLabel: fields[0]!,
    characters: splitList(fields[1]!),
    coreEvent: fields[2]!,
    mainlineRelation: fields[3]!,
    informationDensity: fields[4]!,
    estimatedDurationSec: parseDurationSec(fields[5]!),
    emotionTags: splitList(fields[6]!, /[+、,，/]+/),
    rawLine,
  };
}

export function formatNovelEventSummary(analysis: NovelEventAnalysis): string {
  return analysis.coreEvent;
}

export function formatNovelEventState(analysis: NovelEventAnalysis): string {
  return [
    `涉及角色：${analysis.characters.join("、") || "未标注"}`,
    `主线关系：${analysis.mainlineRelation}`,
    `信息密度：${analysis.informationDensity}`,
    `预估集长：${analysis.estimatedDurationSec}秒`,
    `情绪强度：${analysis.emotionTags.join("+") || "未标注"}`,
  ].join("\n");
}

function extractEventLine(output: string): string {
  const normalized = output
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*|```/g, ""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("|") && line.endsWith("|"));

  if (!normalized) {
    throw new Error("事件分析结果缺少表格行");
  }
  return normalized;
}

function splitList(value: string, pattern: RegExp = /[、,，/]+/) {
  return value
    .split(pattern)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDurationSec(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*秒/);
  if (!match?.[1]) {
    return 0;
  }
  return Math.round(Number(match[1]));
}
