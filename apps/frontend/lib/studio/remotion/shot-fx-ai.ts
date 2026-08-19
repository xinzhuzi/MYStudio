/**
 * AI 2D 镜头表现设计 — 根据每个分镜的对白与画面描述，逐镜组合
 * 运镜（13 模式）+ 特效插件（0~2 个量化档位）+ 镜间转场语义桶 + 字幕音效分类，
 * 防观看疲劳、成片有风格。
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
  ruleTransitionOut,
  type ShotFxAddonId,
  type ShotFxMotionId,
} from "./shot-fx-decisions";
import { CINEMATIC_LUTS, isCinematicLutId } from "./cinematic-luts";
import { ATMOSPHERE_TEMPLATES, isAtmosphereTemplateId, type AtmosphereTemplateId } from "./atmosphere-templates";
import {
  TRANSITION_SEMANTIC_BUCKETS,
  isTransitionSemanticBucketId,
  type TransitionSemanticBucketId,
} from "@/lib/studio/editing/transition-policy";
import {
  availableSubtitleSfxCategories,
  classifySubtitleSfx,
  isSubtitleSfxCategoryId,
  type SubtitleSfxCategoryId,
} from "./subtitle-sfx";

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
  // 环境动画(2026-08-19): 让静态画面活起来
  { id: "float", when: "漂浮浮动——水面、云雾、梦境、空灵场景的缓慢上下漂动" },
  { id: "breathe", when: "呼吸脉动——人物特写、静物、情感内敛镜头的微妙生命感" },
  { id: "sway", when: "风中摇摆——树木、旗帜、布料、花草、户外自然场景" },
  { id: "pulse", when: "变焦脉动——紧张蓄力、心跳感、神秘氛围的推拉交替" },
  { id: "flow", when: "无向漫游——缓慢多轴漂移、时间流逝、回忆闪回" },
];

const ADDON_GUIDE: ReadonlyArray<{ id: ShotFxAddonId; when: string }> = [
  { id: "shake-soft", when: "轻微手持感（3px）——紧张、慌乱、疾行" },
  { id: "afterimage", when: "残影拖影——动作爆点(劈砸轰击)的运动重影" },
  { id: "speed-silhouette", when: "速度剪影——追逐/奔逃时暗影掠过画面" },
  { id: "god-rays", when: "神光光柱——神性/仙阵/晨光穿透氛围" },
  { id: "on-twos", when: "帧步进(On Twos)——动作镜的日式动画节奏" },
  { id: "grade-pulse", when: "调色脉动——情绪推进时色彩强度呼吸变化(需配 grade)" },
  { id: "shake-hard", when: "明显震动（6px）——爆点、撞击、重击" },
  { id: "glow-warm", when: "暖调强辉光——灵光、焰火、神圣、仙气" },
  { id: "glow-dim", when: "暗调弱辉光——夜色、阴郁、神秘氛围" },
  { id: "chroma", when: "RGB 色差分离——能量冲击、现实扭曲瞬间" },
];

/** 成片调色 LUT 指南(08-19 裁定:AI 选卡集=32 张全中国风 cn-*;
 * film-* 为 legacy 闭集成员仅供存量数据,不进指南)。 */
const LUT_GUIDE: ReadonlyArray<{ id: string; when: string }> = CINEMATIC_LUTS
  .filter((l) => l.lutId.startsWith("cn-"))
  .map((l) => ({ id: l.lutId, when: l.description }));

/** 氛围层指南(08-19 multilayer Child2):程序化前景遮挡/粒子模板,情绪+场景语义喂法同 LUT。 */
const ATMOSPHERE_GUIDE: ReadonlyArray<{ id: AtmosphereTemplateId; when: string }> = ATMOSPHERE_TEMPLATES
  .map((template) => ({ id: template.id, when: template.description }));

function buildPrompt(shots: ShotFxAiShotInput[]): string {
  const motionGuide = MOTION_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const addonGuide = ADDON_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const lutGuide = LUT_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const atmoGuide = ATMOSPHERE_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const transitionGuide = TRANSITION_SEMANTIC_BUCKETS.map((b) => `- ${b.id}: ${b.when}`).join("\n");
  const sfxGuide = availableSubtitleSfxCategories().map((c) => `- ${c.id}: ${c.label}`).join("\n");
  const list = shots
    .map((s, i) => `${i + 1}. shotId=${s.shotId}\n   画面: ${s.description || "(无)"}\n   对白: ${s.dialogue || "(无)"}`)
    .join("\n");
  return `你是电影摄影指导，为一部 2D 动态分镜影片逐镜设计镜头表现 = 运镜 + 特效插件 + 转场 + 字幕音效。

运镜（每镜必选其一）：
${motionGuide}

特效插件（每镜可选 0~2 个组合；不选则用该运镜的默认特效，显式给空数组则无特效）：
${addonGuide}

成片调色 LUT——32 张中国风传统色卡（每镜可选一个或省略=不调色；blend 0.2~0.9 克制强度；只给氛围强烈的少数镜配，其余省略防全片刷色）：
${lutGuide}

氛围层——多层合成的前景遮挡/粒子（每镜可选 0~2 个；只给氛围强烈的镜配，安静镜与对白密集镜省略；雾带与薄纱雾不同镜选；克制使用防全片弥漫）：
${atmoGuide}

镜间转场（为每个镜头决定「本镜结束进入下一镜」的转场方式，最后一镜省略；结合相邻两镜剧情连续性与情绪落差选择档位；默认 cut=同场景延续，多数边界应是 cut 或省略）：
${transitionGuide}

字幕音效（每镜按对白/旁白中的声学事件选一个类别；无声学事件则省略；克制使用——只给明确的戏剧性时刻配）：
${sfxGuide}

分镜列表：
${list}

要求：
1. 结合画面描述与对白情绪设计最贴合的组合；运镜与特效要互相成全（如 tilt-up+glow-warm 显巍峨神性、pan-left+shake-soft 显慌乱横移、hold 无特效作爆点前蓄力）
2. **防疲劳纪律（最重要）**：相邻镜头避免完全相同的组合；连续同类情绪时用运镜方向/特效强度做微变化；关键爆点前后可用 hold 做节奏对比；一章之内组合分布要有层次（主打组合+点缀组合），不要全片刷同一配方
3. **转场纪律**：非 cut 转场是稀缺修辞——一章之内非 cut 边界占比不超过三分之一；ink-bleed 与 dream-warp 全章至多各一次；相邻边界避免同桶连用
4. 风格整体性：组合要贴合本片题材气质（仙侠/热血/悬疑等），形成可辨识的镜头风格
5. 同种特效只选一个档位（shake-soft 与 shake-hard 互斥，glow-warm 与 glow-dim 互斥）
6. 只输出 JSON，格式：{"shots": [{"shotId": "...", "motion": "...", "fx": ["插件id", ...], "grade": {"lutId": "...", "blend": 0.2~0.9}, "atmosphere": ["模板id", ...], "transitionOut": "转场桶id或cut", "sfx": "音效类别id"}]}；不需要特效插件的镜头 fx 给空数组或省略；grade/atmosphere 无须时整个字段省略；transitionOut 为 cut 时可省略；无声学事件 sfx 省略
7. 不要输出任何解释文字`;
}

/** 解析 AI 返回的 JSON（容忍 markdown 代码块/前后杂文），校验每个条目。 */
export function parseShotFxMotionResponse(
  raw: string,
  shotIds: Set<string>,
): {
  motions: Record<string, ShotFxMotionId>;
  addons: Record<string, ShotFxAddonId[]>;
  grades: Record<string, { lutId: string; blend: number }>;
  atmospheres: Record<string, AtmosphereTemplateId[]>;
  transitions: Record<string, TransitionSemanticBucketId>;
  sfxCategories: Record<string, SubtitleSfxCategoryId>;
} {
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
  const grades: Record<string, { lutId: string; blend: number }> = {};
  const atmospheres: Record<string, AtmosphereTemplateId[]> = {};
  const transitions: Record<string, TransitionSemanticBucketId> = {};
  const sfxCategories: Record<string, SubtitleSfxCategoryId> = {};
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const shotId = (entry as { shotId?: unknown }).shotId;
      const motion = (entry as { motion?: unknown }).motion;
      if (typeof shotId !== "string" || !shotIds.has(shotId) || !isShotFxMotionId(motion)) {
        continue;
      }
      motions[shotId] = motion;
      const grade = (entry as { grade?: { lutId?: unknown; blend?: unknown } }).grade;
      if (grade && typeof grade.lutId === "string" && isCinematicLutId(grade.lutId)) {
        const blendRaw = Number(grade.blend ?? 1);
        grades[shotId] = {
          lutId: grade.lutId,
          blend: Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 1,
        };
      }
      const transitionOut = (entry as { transitionOut?: unknown }).transitionOut;
      // "cut"/未知桶都不落桶——AI 显式 cut 与缺省同样走边界优先级链的兜底层。
      if (isTransitionSemanticBucketId(transitionOut)) {
        transitions[shotId] = transitionOut;
      }
      const sfx = (entry as { sfx?: unknown }).sfx;
      if (isSubtitleSfxCategoryId(sfx)) {
        sfxCategories[shotId] = sfx;
      }
      // 氛围层(08-19 multilayer Child2):闭集校验+同镜去重+上限 2。
      const atmosphereRaw = (entry as { atmosphere?: unknown }).atmosphere;
      if (Array.isArray(atmosphereRaw)) {
        const seen = new Set<string>();
        const valid: AtmosphereTemplateId[] = [];
        for (const item of atmosphereRaw) {
          if (!isAtmosphereTemplateId(item) || seen.has(item)) continue;
          seen.add(item);
          valid.push(item);
        }
        if (valid.length > 0) atmospheres[shotId] = valid.slice(0, 2);
      }
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
  return { motions, addons, grades, atmospheres, transitions, sfxCategories };
}

/** 关键词启发式兜底（无 AI 时的确定性选择，与渲染侧规则运镜共用单源）。 */
export function heuristicShotFxMotions(shots: ShotFxAiShotInput[]): {
  motions: Record<string, ShotFxMotionId>;
  atmospheres: Record<string, AtmosphereTemplateId[]>;
  transitions: Record<string, TransitionSemanticBucketId>;
  sfxCategories: Record<string, SubtitleSfxCategoryId>;
} {
  const motions: Record<string, ShotFxMotionId> = {};
  // 启发式不配氛围(对齐「启发式不配 grade」裁定:默认氛围刷满全片破坏视觉基线)。
  const atmospheres: Record<string, AtmosphereTemplateId[]> = {};
  const transitions: Record<string, TransitionSemanticBucketId> = {};
  const sfxCategories: Record<string, SubtitleSfxCategoryId> = {};
  shots.forEach((shot, index) => {
    const text = `${shot.description}\n${shot.dialogue}`;
    motions[shot.shotId] = resolveRuleShotFxMotion(text, index);
    // 转场规则兜底只产出 blackout/impact-frame 两档稀缺修辞，其余交回硬切。
    const next = shots[index + 1];
    if (next) {
      const bucket = ruleTransitionOut(text, `${next.description}\n${next.dialogue}`);
      if (bucket) transitions[shot.shotId] = bucket;
    }
    // 字幕音效规则兜底：对白优先命中声学事件（画面描述次之），无资产类自动跳过。
    const category = classifySubtitleSfx(shot.dialogue) ?? classifySubtitleSfx(shot.description);
    if (category) sfxCategories[shot.shotId] = category;
  });
  return { motions, atmospheres, transitions, sfxCategories };
}

/**
 * AI 批量设计分镜镜头表现（运镜 + 可组合特效插件 + 镜间转场 + 字幕音效分类）。
 * 返回 source 标注来源：ai / heuristic / empty（无分镜时）。
 * addons 仅含 AI 显式配置了 fx 字段的镜头（空数组=显式无特效）；缺省=运镜配方默认特效。
 * transitions/sfxCategories 为决策层扩展（08-19 转场+音效缺口）：桶 id 与类别 id
 * 均闭集校验，非法值丢弃；heuristic 兜底与 AI 路径共用规则词表单源。
 */
export async function selectShotFxMotions(
  shots: ShotFxAiShotInput[],
): Promise<{
  motions: Record<string, ShotFxMotionId>;
  addons: Record<string, ShotFxAddonId[]>;
  grades: Record<string, { lutId: string; blend: number }>;
  atmospheres: Record<string, AtmosphereTemplateId[]>;
  transitions: Record<string, TransitionSemanticBucketId>;
  sfxCategories: Record<string, SubtitleSfxCategoryId>;
  source: "ai" | "heuristic" | "empty";
}> {
  if (shots.length === 0) {
    return { motions: {}, addons: {}, grades: {}, atmospheres: {}, transitions: {}, sfxCategories: {}, source: "empty" };
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
    // 启发式兜底不配 grade（AI 选型是增强而非必选；默认 LUT 刷满全片会破坏视觉基线）。
    return {
      ...heuristicShotFxMotions(shots),
      addons: {},
      grades: {},
      source: "heuristic",
    };
  }
}
