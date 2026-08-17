/**
 * AI 2D 运镜选择 — 根据每个分镜的对白与画面描述，逐镜选择 2D 运镜模式（shot-fx 词汇表）。
 *
 * 与 cinematic-preset-ai（3D 相机预设，服务 depth 路径）平行的 2D 版：
 *  - 主路径：aiManager.text（universalAi 兜底）批量分析整章分镜，输出严格 JSON
 *  - 兜底路径：无 AI 配置/调用失败时，复用 resolveRuleShotFxMotion 关键词启发式（确定性，不阻塞渲染）
 *  - 校验：非法模式值一律丢弃，缺失分镜回落规则运镜
 *  - AI 只选模式 ID；panZoom 参数由 SHOT_FX_MOTION_PRESETS 常量表供给，缩放纪律不可被 AI 越界
 *
 * 结果经一键成片写入分镜记录 shotFx 字段（装饰层，不进 sourceFingerprint），
 * App 章节渲染与 CLI 全管线从 studio-workflow-store.json 共享读取。
 */

import { aiManager } from "@/lib/ai/ai-manager";
import {
  isShotFxMotionId,
  resolveRuleShotFxMotion,
  type ShotFxMotionId,
} from "./shot-fx-decisions";

export interface ShotFxAiShotInput {
  shotId: string;
  /** 画面描述（分镜 videoDesc/prompt） */
  description: string;
  /** 角色对白/旁白（ttsSpokenText） */
  dialogue: string;
}

const MOTION_GUIDE: ReadonlyArray<{ id: ShotFxMotionId; when: string }> = [
  { id: "push-in", when: "情绪聚焦、对白紧张、揭示关键主体、特写推进" },
  { id: "pull-out", when: "揭示全景、段落收尾、情绪释放、开场 establishing" },
  { id: "pan-right", when: "主体向右调度、横向跟随、右向展开信息" },
  { id: "pan-left", when: "主体向左调度、横向跟随、左向展开信息" },
  { id: "tilt-up", when: "仰望揭示（建筑/巨人/天空）、由局部到整体、巍峨升腾" },
  { id: "tilt-down", when: "从高处俯摇落到主体、由整体到局部、压迫沉降" },
  { id: "drift", when: "梦境、恍惚、时间流逝、舒缓空镜、回忆" },
  { id: "punch-in", when: "爆炸/劈砍/撞击等动作爆点、冲击强调瞬间" },
  { id: "leave-pull", when: "退场、远去、告别、消失、段落终了拉离" },
];

function buildPrompt(shots: ShotFxAiShotInput[]): string {
  const guide = MOTION_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const list = shots
    .map((s, i) => `${i + 1}. shotId=${s.shotId}\n   画面: ${s.description || "(无)"}\n   对白: ${s.dialogue || "(无)"}`)
    .join("\n");
  return `你是电影摄影指导，为一部 2D 动态分镜影片逐镜选择运镜模式（画面内平移/缩放，无真实 3D 空间）。

可选模式（仅限这些值）：
${guide}

分镜列表：
${list}

要求：
1. 结合画面描述与对白情绪选择最贴合的运镜模式；同一模式可重复使用
2. 全章运镜要有节奏变化，避免连续多镜完全相同（除非叙事确实连贯）；动作爆点优先 punch-in，退场收尾优先 leave-pull
3. 只输出 JSON，格式：{"motions": [{"shotId": "...", "motion": "..."}]}
4. 不要输出任何解释文字`;
}

/** 解析 AI 返回的 JSON（容忍 markdown 代码块/前后杂文），校验每个条目。 */
export function parseShotFxMotionResponse(
  raw: string,
  shotIds: Set<string>,
): { motions: Record<string, ShotFxMotionId> } {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(slice) as {
    motions?: Array<{ shotId?: unknown; motion?: unknown }>;
  };
  const motions: Record<string, ShotFxMotionId> = {};
  if (Array.isArray(parsed.motions)) {
    for (const entry of parsed.motions) {
      if (!entry || typeof entry !== "object") continue;
      const shotId = (entry as { shotId?: unknown }).shotId;
      const motion = (entry as { motion?: unknown }).motion;
      if (typeof shotId === "string" && shotIds.has(shotId) && isShotFxMotionId(motion)) {
        motions[shotId] = motion;
      }
    }
  }
  return { motions };
}

/** 关键词启发式兜底（无 AI 时的确定性选择，与渲染侧规则运镜共用单源）。 */
export function heuristicShotFxMotions(shots: ShotFxAiShotInput[]): {
  motions: Record<string, ShotFxMotionId>;
} {
  const motions: Record<string, ShotFxMotionId> = {};
  shots.forEach((shot, index) => {
    motions[shot.shotId] = resolveRuleShotFxMotion(
      `${shot.description}\n${shot.dialogue}`,
      index,
    );
  });
  return { motions };
}

/**
 * AI 批量选择分镜 2D 运镜模式。
 * 返回 source 标注来源：ai / heuristic / empty（无分镜时）。
 */
export async function selectShotFxMotions(
  shots: ShotFxAiShotInput[],
): Promise<{ motions: Record<string, ShotFxMotionId>; source: "ai" | "heuristic" | "empty" }> {
  if (shots.length === 0) {
    return { motions: {}, source: "empty" };
  }
  const shotIds = new Set(shots.map((s) => s.shotId));
  try {
    const result = await aiManager.text({
      binding: { agent: "universalAi" },
      messages: [
        { role: "system", content: "你是专业电影摄影指导，只输出严格 JSON。" },
        { role: "user", content: buildPrompt(shots) },
      ],
      temperature: 0.3,
      maxTokens: 4096,
    });
    if (!result.success || !result.text) throw new Error(result.error || "AI 调用失败");
    const parsed = parseShotFxMotionResponse(result.text, shotIds);
    if (Object.keys(parsed.motions).length === 0) throw new Error("AI 未返回有效运镜模式");
    return { ...parsed, source: "ai" };
  } catch {
    return { ...heuristicShotFxMotions(shots), source: "heuristic" };
  }
}
