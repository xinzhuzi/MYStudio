/**
 * AI 2D 镜头表现设计 — 根据每个分镜的对白与画面描述，逐镜组合
 * 运镜（13 模式）+ 特效插件（0~2 个量化档位），防观看疲劳、成片有风格。
 *
 * 与 cinematic-preset-ai（3D 相机预设，服务 depth 路径）平行的 2D 版：
 *  - 主路径：aiManager.text（universalAi 兜底）批量分析整章分镜，输出严格 JSON
 *  - 兜底路径：无 AI 配置/调用失败时，复用 resolveRuleShotFxMotion 关键词启发式（确定性，不阻塞渲染）
 *  - 校验：非法运镜/插件值一律丢弃，缺失分镜回落规则运镜；同种特效互斥、上限 2 插件
 *  - AI 只选 ID；运镜参数与特效强度均由常量表供给，锐度纪律不可被 AI 越界
 *
 * 结果经一键成片写入分镜记录 shotFx 字段（motion + addons，装饰层不进
 * sourceFingerprint），App 章节渲染与 CLI 全管线从 studio-workflow-store.json 共享读取。
 */

import { aiManager } from "@/lib/ai/ai-manager";
import {
  isShotFxAddonId,
  isShotFxMotionId,
  resolveRuleShotFxMotion,
  type ShotFxAddonId,
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
  { id: "punch-in", when: "动作爆点急推（默认带强抖+色差，可用 fx 覆盖）" },
  { id: "chase-in", when: "追逐/奔逃快推（默认带轻抖，可用 fx 覆盖）" },
  { id: "aura-push", when: "灵光/焰火/仙阵缓推（默认带暖辉光，可用 fx 覆盖）" },
  { id: "gloom-pull", when: "阴暗/夜雾/深渊缓拉（默认带暗辉光，可用 fx 覆盖）" },
  { id: "leave-pull", when: "退场、远去、告别、消失、段落终了拉离" },
  { id: "hold", when: "锁帧静止——重大爆点/转折前的蓄力对比、台词关键句定格" },
];

const ADDON_GUIDE: ReadonlyArray<{ id: ShotFxAddonId; when: string }> = [
  { id: "shake-soft", when: "轻微手持感（3px）——紧张、慌乱、疾行" },
  { id: "shake-hard", when: "明显震动（6px）——爆点、撞击、重击" },
  { id: "glow-warm", when: "暖调强辉光——灵光、焰火、神圣、仙气" },
  { id: "glow-dim", when: "暗调弱辉光——夜色、阴郁、神秘氛围" },
  { id: "chroma", when: "RGB 色差分离——能量冲击、现实扭曲瞬间" },
];

function buildPrompt(shots: ShotFxAiShotInput[]): string {
  const motionGuide = MOTION_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const addonGuide = ADDON_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const list = shots
    .map((s, i) => `${i + 1}. shotId=${s.shotId}\n   画面: ${s.description || "(无)"}\n   对白: ${s.dialogue || "(无)"}`)
    .join("\n");
  return `你是电影摄影指导，为一部 2D 动态分镜影片逐镜设计镜头表现 = 运镜 + 特效插件（可自由组合）。

运镜（每镜必选其一）：
${motionGuide}

特效插件（每镜可选 0~2 个组合；不选则用该运镜的默认特效，显式给空数组则无特效）：
${addonGuide}

分镜列表：
${list}

要求：
1. 结合画面描述与对白情绪设计最贴合的组合；运镜与特效要互相成全（如 tilt-up+glow-warm 显巍峨神性、pan-left+shake-soft 显慌乱横移、hold 无特效作爆点前蓄力）
2. **防疲劳纪律（最重要）**：相邻镜头避免完全相同的组合；连续同类情绪时用运镜方向/特效强度做微变化；关键爆点前后可用 hold 做节奏对比；一章之内组合分布要有层次（主打组合+点缀组合），不要全片刷同一配方
3. 风格整体性：组合要贴合本片题材气质（仙侠/热血/悬疑等），形成可辨识的镜头风格
4. 同种特效只选一个档位（shake-soft 与 shake-hard 互斥，glow-warm 与 glow-dim 互斥）
5. 只输出 JSON，格式：{"shots": [{"shotId": "...", "motion": "...", "fx": ["插件id", ..."]}]}；不需要特效插件的镜头 fx 给空数组或省略
6. 不要输出任何解释文字`;
}

/** 解析 AI 返回的 JSON（容忍 markdown 代码块/前后杂文），校验每个条目。 */
export function parseShotFxMotionResponse(
  raw: string,
  shotIds: Set<string>,
): { motions: Record<string, ShotFxMotionId>; addons: Record<string, ShotFxAddonId[]> } {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(slice) as {
    shots?: Array<{ shotId?: unknown; motion?: unknown; fx?: unknown }>;
    motions?: Array<{ shotId?: unknown; motion?: unknown; fx?: unknown }>;
  };
  const entries = Array.isArray(parsed.shots) ? parsed.shots : parsed.motions;
  const motions: Record<string, ShotFxMotionId> = {};
  const addons: Record<string, ShotFxAddonId[]> = {};
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const shotId = (entry as { shotId?: unknown }).shotId;
      const motion = (entry as { motion?: unknown }).motion;
      if (typeof shotId !== "string" || !shotIds.has(shotId) || !isShotFxMotionId(motion)) {
        continue;
      }
      motions[shotId] = motion;
      const fx = (entry as { fx?: unknown }).fx;
      if (Array.isArray(fx)) {
        // 显式插件配置（可为空数组=无特效）；同种效果取首个档位。
        const seenKinds = new Set<string>();
        const valid: ShotFxAddonId[] = [];
        for (const item of fx) {
          if (!isShotFxAddonId(item)) continue;
          const kind = item.split("-")[0] === "shake" ? "shake" : item.split("-")[0] === "glow" ? "glow" : "chroma";
          if (seenKinds.has(kind)) continue;
          seenKinds.add(kind);
          valid.push(item);
        }
        addons[shotId] = valid.slice(0, 2);
      }
    }
  }
  return { motions, addons };
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
 * AI 批量设计分镜镜头表现（运镜 + 可组合特效插件）。
 * 返回 source 标注来源：ai / heuristic / empty（无分镜时）。
 * addons 仅含 AI 显式配置了 fx 字段的镜头（空数组=显式无特效）；缺省=运镜配方默认特效。
 */
export async function selectShotFxMotions(
  shots: ShotFxAiShotInput[],
): Promise<{
  motions: Record<string, ShotFxMotionId>;
  addons: Record<string, ShotFxAddonId[]>;
  source: "ai" | "heuristic" | "empty";
}> {
  if (shots.length === 0) {
    return { motions: {}, addons: {}, source: "empty" };
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
    if (Object.keys(parsed.motions).length === 0) throw new Error("AI 未返回有效镜头表现");
    return { ...parsed, source: "ai" };
  } catch {
    return { ...heuristicShotFxMotions(shots), addons: {}, source: "heuristic" };
  }
}
