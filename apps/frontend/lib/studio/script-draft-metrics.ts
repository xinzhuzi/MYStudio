/**
 * 剧本确定性自检指标(G20/G25/G26/父 D2/父 I6/I8)。
 * 消费方:useScriptStageActions(审核 prompt 注入,父 I5)与 ScriptTab(只读展示)。
 *
 * 阈值单一真源 = 通用剧本手册条款(父 I6,代码常量注释回指节标题,不锚行号):
 * - 单集参考时长 ±10 秒;各场秒数合计对账同一口径(手册【输出格式规范】「九、时长与视觉预算」节;
 *   v3 已由「八、时长控制」改名合并,「约束」节同指引——锚节标题以抗挪行)
 * - 配音总量(台词+OS)≤ 150 字/分钟;OS/旁白占比 ≤ 40%
 * - △ 上限 = ⌊时长秒 ÷ 10⌋(G26 单值:每 △ 按 10 秒预算;题材包只收紧不放宽)
 *   (G35 留白:题材包〔script_narrative〕可声明更严 △ 预算——道劫/甜宠当前两包均未声明,
 *   代码不预建输入口,待包侧真声明后再接线收紧)
 * - 单句(对白/OS)≤ 20 字@16:9 / ≤ 15 字@9:16(G7)
 * 解析口径(父 D2,取自 out/b-plus-script-ch1*.md 实样结构):
 * - 每行去 `**` 与首尾空白后匹配;场头 `{场号} {场景名} {时间}/{光线} ·约{N}秒`
 * - 语音行 `名[（括注）][：:]内容`;`V.S.（旁白…）` 计 OS;`人物：` 行不计对白
 * - 语音内容在同行;同行为空则取下一非空非标记行(冒号后换行形态)
 * - 超长句按句本体计量:行内「| 环境音/音效」注释列不计入字数(G25)
 * - 画幅真源 = 剧本头部第三行自述(父 I7/I8:只按「已确定要求：」前缀 + `16:9`/`9:16`
 *   子串匹配,不匹配枚举全集);opts.aspectRatio 仅兜底
 * - 格式漂移 → 指标给 0/null 并入 flags,永不抛错
 */

export interface ScriptDraftMetricsScene {
  id: string;
  title: string;
  seconds: number | null;
  beats: number;
  voiceChars: number;
}

export interface ScriptDraftMetrics {
  scenes: ScriptDraftMetricsScene[];
  /** 各场 ·约N秒 合计(缺标注的场不计;全部缺失时无对账值) */
  totalSeconds: number;
  /** durationMin × 60 */
  targetSeconds: number;
  beats: number;
  /** ⌊targetSeconds/10⌋(G26) */
  beatLimit: number;
  dialogueChars: number;
  osChars: number;
  /** os/(dialogue+os);无语音时 0 */
  osRatio: number;
  /** durationMin × 150(150 字/分钟,手册条款) */
  voiceCharLimit: number;
  overlongLines: { scene: string; text: string; chars: number }[];
  /** 16:9 → 20 字;9:16 → 15 字(G7) */
  lineLimit: number;
  flags: string[];
}

const SCENE_HEADER_RE = /^(\d+-\d+)\s+(.+)$/;
const SCENE_SECONDS_RE = /·约(\d+)秒/;
// 名字类须排除全角「（」:否则贪婪吞掉括注(如「V.S.（旁白，冷）」整段成名)
const VOICE_LINE_RE = /^([^：:\s（]{1,20})(（[^）]*）)?[：:](.*)$/;
const ASPECT_HEADER_RE = /^#\s*已确定要求[：:]/;
const STRIP_FOR_COUNT_RE = /[\p{P}\p{S}\s]/gu;

/** 行内注释列(「| 环境音/音效」等)剥离后按句本体计字数(G25)。 */
function countChars(content: string): number {
  return content.split("|")[0]!.replace(STRIP_FOR_COUNT_RE, "").length;
}

/** 续行判定:语音行内容为空时,取下一非空且非标记(△/场头/人物行/分隔线/标题)的行。 */
function isMarkerLine(line: string): boolean {
  return (
    line.startsWith("△") ||
    SCENE_HEADER_RE.test(line) ||
    /^人物[：:]/.test(line) ||
    line === "---" ||
    line.startsWith("#")
  );
}

/** 画幅真源=头部「已确定要求：」自述行(父 I7/I8);opts 兜底,再缺省 16:9。 */
function resolveAspectRatio(lines: string[], fallback?: string): "16:9" | "9:16" {
  for (const raw of lines) {
    if (!ASPECT_HEADER_RE.test(raw)) continue;
    if (raw.includes("9:16")) return "9:16";
    if (raw.includes("16:9")) return "16:9";
    break;
  }
  return fallback?.includes("9:16") ? "9:16" : "16:9";
}

export function analyzeScriptDraft(
  text: string,
  opts: { durationMin?: number; aspectRatio?: string } = {},
): ScriptDraftMetrics {
  const durationMin = opts.durationMin && opts.durationMin > 0 ? opts.durationMin : 3;
  const targetSeconds = Math.round(durationMin * 60);
  const beatLimit = Math.floor(targetSeconds / 10);
  const voiceCharLimit = Math.round(durationMin * 150);
  const lines = (text ?? "").split(/\r?\n/);
  const cleaned = lines.map((line) => line.replaceAll("**", "").trim());
  const aspect = resolveAspectRatio(cleaned, opts.aspectRatio);
  const lineLimit = aspect === "9:16" ? 15 : 20;

  const scenes: ScriptDraftMetricsScene[] = [];
  const flags: string[] = [];
  const overlongLines: { scene: string; text: string; chars: number }[] = [];
  let beats = 0;
  let dialogueChars = 0;
  let osChars = 0;
  let current: ScriptDraftMetricsScene | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i]!;

    const sceneMatch = SCENE_HEADER_RE.exec(line);
    if (sceneMatch) {
      const secondsMatch = SCENE_SECONDS_RE.exec(line);
      current = {
        id: sceneMatch[1]!,
        title: line.replace(/\s*·约\d+秒\s*/g, "").slice(sceneMatch[1]!.length).trim(),
        seconds: secondsMatch ? Number(secondsMatch[1]) : null,
        beats: 0,
        voiceChars: 0,
      };
      if (current.seconds === null) flags.push(`场 ${current.id} 缺·约N秒标注`);
      scenes.push(current);
      continue;
    }

    if (line.startsWith("△")) {
      beats++;
      if (current) current.beats++;
      continue;
    }

    const voiceMatch = VOICE_LINE_RE.exec(line);
    if (!voiceMatch) continue;
    const name = voiceMatch[1]!;
    if (name === "人物") continue; // 人物表行不计对白(父 D2)
    if (name === "SFX") continue; // SFX 音效配方行非语音(手册 §三 音效意图;语音=台词+OS,G20),不入对白/OS/超长句
    let content = voiceMatch[3]?.trim() ?? "";
    if (!content) {
      // 冒号后换行形态:取下一非空非标记行为语音内容
      for (let j = i + 1; j < cleaned.length; j++) {
        const next = cleaned[j]!;
        if (!next) continue;
        if (isMarkerLine(next)) break;
        content = next;
        i = j;
        break;
      }
    }
    const parenthetical = voiceMatch[2]?.slice(1, -1) ?? "";
    const isOS =
      name === "OS" || (name === "V.S." && parenthetical.startsWith("旁白"));
    const chars = countChars(content);
    if (isOS) osChars += chars;
    else dialogueChars += chars;
    if (current) current.voiceChars += chars;
    if (chars > lineLimit) {
      overlongLines.push({ scene: current?.id ?? "—", text: content.split("|")[0]!.trim(), chars });
    }
  }

  const totalSeconds = scenes.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  if (scenes.length === 0) {
    flags.push("未识别到场次段落（格式漂移，场秒/△ 对账不可用）");
  } else if (scenes.some((s) => s.seconds !== null)) {
    if (Math.abs(totalSeconds - targetSeconds) > 10) {
      flags.push(`场秒合计 ${totalSeconds}s，偏离目标 ${targetSeconds}s 超过 ±10s`);
    }
  }
  if (beats > beatLimit) {
    flags.push(`△ ${beats} 个超上限 ${beatLimit}（每 △ 按 10 秒预算）`);
  }
  const voiceChars = dialogueChars + osChars;
  if (voiceChars > voiceCharLimit) {
    flags.push(`语音字数 ${voiceChars} 超上限 ${voiceCharLimit}（150 字/分钟）`);
  }
  const osRatio = voiceChars > 0 ? osChars / voiceChars : 0;
  if (osRatio > 0.4) {
    flags.push(`OS 占比 ${(osRatio * 100).toFixed(1)}% 超上限 40%`);
  }
  if (overlongLines.length > 0) {
    flags.push(`超长句 ${overlongLines.length} 条（单句上限 ${lineLimit} 字@${aspect}）`);
  }

  return {
    scenes,
    totalSeconds,
    targetSeconds,
    beats,
    beatLimit,
    dialogueChars,
    osChars,
    osRatio,
    voiceCharLimit,
    overlongLines,
    lineLimit,
    // 返回前去重:同 id 场重复缺标注等会产生重复 flag(React key 重复与重复报告双治)
    flags: [...new Set(flags)],
  };
}

/** 指标文本化:首行=父 I5 标题;审核 prompt 注入与 UI 共用同一输出。 */
export function formatScriptDraftMetrics(m: ScriptDraftMetrics): string {
  const voiceChars = m.dialogueChars + m.osChars;
  const osPct = voiceChars > 0 ? `${(m.osRatio * 100).toFixed(1)}%` : "0%";
  const sceneSummary =
    m.scenes
      .map((s) => `${s.id} ${s.seconds === null ? "缺·约" : `${s.seconds}s`}·△${s.beats}·语音${s.voiceChars}`)
      .join("；") || "未识别到场次";
  const lines = [
    "## 自检指标（代码计算，以此为准）",
    `- 场秒合计：${m.totalSeconds}s（目标 ${m.targetSeconds}s，允许 ±10s）`,
    `- 视觉预算：△ ${m.beats} 个（上限 ${m.beatLimit}，每 △ 按 10 秒预算）`,
    `- 语音字数：对白 ${m.dialogueChars} + OS ${m.osChars} = ${voiceChars} 字（上限 ${m.voiceCharLimit}；OS 占比 ${osPct}，上限 40%）`,
    `- 单句长度：上限 ${m.lineLimit} 字，超长 ${m.overlongLines.length} 条`,
    `- 场次：${sceneSummary}`,
    `- 自检结论：${m.flags.length ? m.flags.join("；") : "自检通过"}`,
  ];
  return lines.join("\n");
}
