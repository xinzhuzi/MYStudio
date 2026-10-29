/**
 * W0 剧本检查门·四项判定单一真源(10-29 script-rootcure-clearance design §1.1)。
 *
 * 主门(前端写回位 useProductionPlanningActions.handleStoryboardTable)与副门
 * (apps/build/timeline/script-precheck.ts 管线入口)共用本文件——副门跨域 import,
 * 先例=run-full-pipeline.ts 直接 import @/lib/studio 纯模块。只做纯算术/字面比对,
 * 不做任何 IO、不调模型。
 *
 * 判定线(本文件 export,禁两处定义):
 * - 时长帽:Σduration > cap → RED(strict 帽 195 / 通用帽 180,调用方传值)。
 * - 语速:对白判线 4.0(=script-draft-metrics VOICE_CPS_MAX 语义,R15/Q1 超标判定端,
 *   门内单列常量并注释回指)/转译旁白判线 4.6;>5.2 恒 RED;判线~5.2 YELLOW。
 * - 台词勾销账:剧本语音行逐句字面子串覆盖 100%,缺一句即 RED;禁语义匹配。
 * - OS 占比预算:非豁免 OS 占比>40% 或非豁免 OS 连续≥3段 → YELLOW(永不阻断,
 *   RED 清单封闭=语速>5.2/超帽/勾销<100% 三项)。
 *
 * 字数归一全链一套:extractSpeech(剥「角色：」前缀)→ 剥「|注释列」→ STRIP_FOR_COUNT_RE
 * 去标点(script-draft-metrics.ts 单源,E1)。
 *
 * 口径B(voice 实长):audioActualSeconds 缺失=pending,pending 不判不阻;禁止用
 * 旧表 audioRef/估计值充数(design §5.7)。
 */

import { STRIP_FOR_COUNT_RE, type ScriptVoiceLine } from "./script-draft-metrics";

/** 剥「角色：」前缀与旁白标记（与 storyboard-table.ts extractSpeech 逐字同逻辑的内联副本——避免拉入 @/lib/studio/manuals 别名链在 vitest 中不可达）。 */
function extractSpeech(lines: string): string {
  const text = (lines ?? "").trim();
  if (!text || text === "无台词" || text === "—") return "";
  const colonIdx = text.search(/[:：]/);
  return colonIdx >= 0 ? text.slice(colonIdx + 1).trim() : text;
}

// ── 输入 ──
export interface ScriptPrecheckRowInput {
  index: number;                     // StoryboardTableRow.index（报告定位用）
  duration: number;                  // declared 镜秒（StoryboardTableRow.duration）
  lines: string;                     // 台词列原文（含「角色：」「旁白：」标签）
  audioActualSeconds?: number;       // 口径B：audioRef 绑定 wav 实长（秒）；undefined=记 pending
}
export interface ScriptPrecheckInput {
  rows: ScriptPrecheckRowInput[];
  scriptVoiceLines: ScriptVoiceLine[];  // 剧本台词真源（extractScriptVoiceLines, script-draft-metrics E1）
  durationCapSeconds: number;           // strict=195 / 通用=180（调用方从 daojie-duration-policy + 180 常量传值）
  sourceTextForExemption?: string;      // 转译豁免的字面溯源域（原文；strict 时传 sourceText）
}

// ── 判定线常量（本文件 export，禁两处定义）──
/** 对白判线（=script-draft-metrics VOICE_CPS_MAX 语义,R15/Q1 超标判定端 4 字/秒） */
export const SPEECH_CPS_DIALOGUE = 4.0;
/** 转译旁白判线 */
export const SPEECH_CPS_TRANSLATION = 4.6;
/** RED 阻断线（>5.2） */
export const SPEECH_CPS_RED = 5.2;

// ── 输出 ──
export interface ScriptPrecheckReceipt {
  passed: boolean;        // false = 存在 RED
  red: string[];          // RED 明细（人读，逐条带镜号）
  yellow: string[];       // YELLOW 明细（落档不阻断）
  pending: string[];      // 口径B缺失等（informational）
  checks: {
    durationCap:   { totalSeconds: number; cap: number; passed: boolean };
    speechRate:    { rows: Array<{ index: number; kind: "dialogue"|"translation"|"none"; chars: number;
                                       cpsA: number; cpsB: number | null;  // null=pending
                                       band: "green"|"yellow"|"red"|"pending" }>; };
    dialogueCoverage: { missing: Array<{ scene: string; speech: string }>; coveredRatio: number; passed: boolean };
    osBudget:      { osRatio: number; exemptRatio: number; maxConsecutiveOs: number; passed: boolean };
  };
  summary: string;        // 单段人读文本：RED 优先列全，无 RED 时列 YELLOW/pending 计数（throw/toast/supervisionReport 三用）
}

/** 字面归一(countChars 的字符串版):剥「|注释列」→ STRIP_FOR_COUNT_RE 去标点。全链一套归一。 */
export function normalizeLiteral(text: string): string {
  return (text ?? "").split("|")[0]!.replace(STRIP_FOR_COUNT_RE, "");
}

/** 转译行判定(script-precheck 域):lines 以 旁白：/OS：/OS(/VO/V.O. 起头=translation。 */
const TRANSLATION_LINE_RE = /^(?:旁白|OS|os|VO|V\.O\.)(?:[（(][^）)]*[）)])?\s*[：:]/;

function classifyRowLines(lines: string): "translation" | "dialogue" | "none" {
  const text = (lines ?? "").trim();
  if (!text || text === "无台词" || text === "—") return "none";
  return TRANSLATION_LINE_RE.test(text) ? "translation" : "dialogue";
}

/** ①时长帽：Σduration > cap → RED（合计容差 0，严格大于才 RED）。 */
export function checkDurationCap(rows: { duration: number }[], cap: number):
  { totalSeconds: number; cap: number; passed: boolean } {
  const totalSeconds = rows.reduce((total, row) => total + row.duration, 0);
  return { totalSeconds, cap, passed: !(totalSeconds > cap) };
}

/** ②语速双口径：A=chars/duration；B=chars/audioActualSeconds（undefined→pending 不判）。
 *  行类别：lines 以 旁白：/OS：/OS(/VO/V.O. 起头=translation（判线4.6），否则 dialogue（判线4.0）。
 *  分带：cps≤判线=green；判线<cps≤5.2=yellow；cps>5.2=red；无 B 数据=pending。
 *  chars=剥标签+剥|注释列+去标点字数（§1.3 归一）。 */
export function checkSpeechRate(rows: ScriptPrecheckRowInput[]):
  ScriptPrecheckReceipt["checks"]["speechRate"] & { red: string[]; yellow: string[]; pendingCount: number; pending: string[] } {
  const red: string[] = [];
  const yellow: string[] = [];
  const pending: string[] = [];
  const measured = rows.map((row) => {
    const kind = classifyRowLines(row.lines);
    const chars = normalizeLiteral(extractSpeech(row.lines)).length;
    const line = kind === "translation" ? SPEECH_CPS_TRANSLATION : SPEECH_CPS_DIALOGUE;
    const bandOf = (cps: number): "green" | "yellow" | "red" =>
      cps > SPEECH_CPS_RED ? "red" : cps > line ? "yellow" : "green";
    const cpsA = chars === 0 ? 0 : row.duration > 0 ? chars / row.duration : Number.POSITIVE_INFINITY;
    const cpsB = row.audioActualSeconds !== undefined && row.audioActualSeconds > 0 && chars > 0
      ? chars / row.audioActualSeconds
      : null;
    let band: "green" | "yellow" | "red" | "pending";
    if (cpsA === Number.POSITIVE_INFINITY || bandOf(cpsA) === "red" || (cpsB !== null && bandOf(cpsB) === "red")) band = "red";
    else if (bandOf(cpsA) === "yellow" || (cpsB !== null && bandOf(cpsB) === "yellow")) band = "yellow";
    else if (cpsB === null && chars > 0) band = "pending";
    else band = "green";
    if (band === "red") {
      const source = cpsA === Number.POSITIVE_INFINITY || bandOf(cpsA) === "red"
        ? `declared ${cpsA === Number.POSITIVE_INFINITY ? "∞" : cpsA.toFixed(1)}字/秒`
        : `voice实测 ${cpsB!.toFixed(1)}字/秒`;
      red.push(`镜${row.index} ${kind === "translation" ? "转译" : "对白"}语速 ${source} 超 ${SPEECH_CPS_RED}（${chars}字/${row.duration}s）`);
    } else if (band === "yellow") {
      const source = bandOf(cpsA) === "yellow" ? `declared ${cpsA.toFixed(1)}字/秒` : `voice实测 ${cpsB!.toFixed(1)}字/秒`;
      yellow.push(`镜${row.index} ${kind === "translation" ? "转译" : "对白"}语速 ${source} 超判线 ${line}（${chars}字/${row.duration}s）`);
    } else if (band === "pending") {
      pending.push(`镜${row.index} 口径B缺失（voice 实长未绑定，仅口径A=${cpsA.toFixed(1)}字/秒）`);
    }
    return { index: row.index, kind, chars, cpsA, cpsB, band };
  });
  return { rows: measured, red, yellow, pendingCount: pending.length, pending };
}

/** ③台词勾销账：剧本语音行逐句覆盖。normalized(剧本句) 须为 normalized(全表台词拼接) 的子串；
 *  缺一句即 coveredRatio<1 → RED。禁语义匹配。 */
export function checkDialogueCoverage(scriptVoiceLines: ScriptVoiceLine[], rows: ScriptPrecheckRowInput[]):
  ScriptPrecheckReceipt["checks"]["dialogueCoverage"] {
  const haystack = normalizeLiteral(rows.map((row) => row.lines).join("\n"));
  const missing: Array<{ scene: string; speech: string }> = [];
  let total = 0;
  for (const line of scriptVoiceLines) {
    const needle = normalizeLiteral(line.speech);
    if (!needle) continue;
    total++;
    if (!haystack.includes(needle)) missing.push({ scene: line.scene, speech: line.speech });
  }
  const covered = total - missing.length;
  return { missing, coveredRatio: total > 0 ? covered / total : 1, passed: missing.length === 0 };
}

/** ④OS占比预算：分子=非豁免OS字数，分母=全部语音字数（对白+OS全量，口径=script-draft-metrics
 *  osRatio=dialogueChars+osChars 全量分母）；ratio>0.40 或 非豁免OS连续≥3段 → YELLOW
 *  （PRD RED 清单不含此项，永不阻断）。
 *  转译豁免（机读代理）：OS行 normalized(speech) 是 sourceTextForExemption(归一后) 的子串
 *  → 豁免（剔出分子与连段游标；对白行同样打断游标）。 */
export function checkOsBudget(rows: ScriptPrecheckRowInput[], sourceTextForExemption?: string):
  ScriptPrecheckReceipt["checks"]["osBudget"] & { yellow: string[] } {
  const exemptionHay = sourceTextForExemption !== undefined ? normalizeLiteral(sourceTextForExemption) : null;
  let osChars = 0;          // 非豁免 OS 字数（分子）
  let voiceChars = 0;       // 全部语音字数（对白+OS 全量，分母）
  let exemptChars = 0;      // 豁免 OS 字数（只进豁免率，不进分子）
  let consecutiveOs = 0;
  let maxConsecutiveOs = 0;
  const yellow: string[] = [];
  for (const row of rows) {
    const kind = classifyRowLines(row.lines);
    if (kind === "none") continue; // 无台词镜:不计字数、不打断连段游标(透明)
    const chars = normalizeLiteral(extractSpeech(row.lines)).length;
    voiceChars += chars;
    if (kind !== "translation") {
      consecutiveOs = 0; // 对白行打断连段游标
      continue;
    }
    const exempt = exemptionHay !== null && chars > 0
      && normalizeLiteral(extractSpeech(row.lines)).length > 0
      && exemptionHay.includes(normalizeLiteral(extractSpeech(row.lines)));
    if (exempt) {
      exemptChars += chars; // 剔出分子与连段游标
      continue;
    }
    osChars += chars;
    consecutiveOs++;
    maxConsecutiveOs = Math.max(maxConsecutiveOs, consecutiveOs);
  }
  const osRatio = voiceChars > 0 ? osChars / voiceChars : 0;
  const exemptRatio = voiceChars > 0 ? exemptChars / voiceChars : 0;
  if (osRatio > 0.4) yellow.push(`非豁免OS占比 ${(osRatio * 100).toFixed(1)}% 超上限 40%`);
  if (maxConsecutiveOs >= 3) yellow.push(`非豁免OS连续 ${maxConsecutiveOs} 段超 2 段`);
  return { osRatio, exemptRatio, maxConsecutiveOs, passed: yellow.length === 0, yellow };
}

/** 四函数串行 + 汇总分带 + summary（RED 优先列首 3 条；无 RED 时列 YELLOW/pending 计数）。 */
export function runScriptPrecheck(input: ScriptPrecheckInput): ScriptPrecheckReceipt {
  const durationCap = checkDurationCap(input.rows, input.durationCapSeconds);
  const speechRate = checkSpeechRate(input.rows);
  const dialogueCoverage = checkDialogueCoverage(input.scriptVoiceLines, input.rows);
  const osBudget = checkOsBudget(input.rows, input.sourceTextForExemption);
  const red = [
    ...(durationCap.passed ? [] : [`分镜总时长 ${durationCap.totalSeconds}秒 超上限 ${durationCap.cap}秒`]),
    ...speechRate.red,
    ...(dialogueCoverage.passed
      ? []
      : dialogueCoverage.missing.map((item) => `台词勾销缺句（场${item.scene}）：${item.speech}`)),
  ];
  const yellow = [...speechRate.yellow, ...osBudget.yellow];
  const pending = speechRate.pending;
  const summary = red.length > 0
    ? `分镜机读检查：RED ${red.length} 项（${red.slice(0, 3).join("；")}）；YELLOW ${yellow.length} 项；pending ${pending.length} 镜`
    : `分镜机读检查：RED 0 项${yellow.length > 0 ? `（YELLOW ${yellow.length} 项：${yellow.slice(0, 3).join("；")}）` : ""}；pending ${pending.length} 镜`;
  return {
    passed: red.length === 0,
    red,
    yellow,
    pending,
    checks: {
      durationCap,
      speechRate: { rows: speechRate.rows },
      dialogueCoverage,
      osBudget,
    },
    summary,
  };
}
