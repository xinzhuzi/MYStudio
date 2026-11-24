// 剧本结构类型(故事骨架、实体抽取、剧本计划、衍生资产、系列圣经、分集大纲)。2026-11-24 超线文件拆分:从 studio-production-types.ts 拆出;入口与导出名不变。

import type { StudioSourceIdentity } from "./studio";

/** ===== 编剧深度实体（对齐统一工作流计划 M1–M7 / 数据模型规范 §3.12）===== */

export interface StorySkeleton {
  id: string;
  projectId: string;
  coreHook: string;
  protagonistArc: string;
  threeActs: { setup: string; confrontation: string; resolution: string };
  episodePlan: { episodeIndex: number; title: string; summary: string }[];
  payWalls: number[];
}

export interface EntityExtractionResult extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  /**
   * 提取时对「该章剧本正文」盖的戳(1011 用户令补:剧本重写后旧提取集静默复用
   * =一键生成按旧实体集烧图)。口径=scriptPlanSourceFingerprint(零新造,与
   * 导演规划/章流水线发车指纹同公式);资产一键生成前比对,漂移=提示先重新
   * 提取。存量批次无此字段=静默不比对(兼容同 08-27 口径)。
   * G34 范围(1012):一键生成、失败行重试、章流水线发车三处守卫(toast.warning
   * 提示后继续,不阻断;流水线另在发车指纹台账留 extractionFingerprint 戳,
   * 提取集落后于剧本错位事后可查);G37/R7 分镜自动补图已纳入同款比对(fill
   * 触发前比对本戳,错位行 failed+原因「提取集过期」落账,不烧图不阻断其余行)
   * ——G34 留白清零。
   */
  scriptFingerprint?: string;
  characters: {
    characterId: string;
    name: string;
    aliases: string[];
    note?: string;
    /**
     * 角色重要度（配音分层分配用）：protagonist 优先挑最佳片段；
     * npc 允许复用配角音色。缺省按 supporting 处理。
     */
    importance?: "protagonist" | "supporting" | "npc";
  }[];
  /** 10-20 补:场景/道具别名随批留痕(与角色同口径);存量分片无此字段=空。 */
  scenes: { sceneId: string; name: string; aliases?: string[]; note?: string }[];
  props: { assetId: string; name: string; aliases?: string[]; note?: string }[];
}

export interface ScriptPlan extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  /**
   * 预划剧本指纹锚(08-27 二期 R1):导演规划落库时对「该章剧本正文」盖的戳
   * (scriptPlanSourceFingerprint,不含 manual/user 指令)。剧本再编辑后与当前
   * 值不一致 → 面板提示「预划已过期」。存量 plan 无此字段 = 静默不比对。
   */
  scriptFingerprint?: string;
  /**
   * 来源剧本条目指纹(10-13-audit4-downstream D2,裁定⑤):导演规划落库时记
   * 所据 scriptDraft 条目的 id+updatedAt,与 G3 reviewTarget 同一形态、零存储
   * 桶新增。分镜表门禁据此识别「规划所基于的剧本版本」;存量 plan 无此字段 =
   * 回落现行为(不提示)。
   */
  sourceScript?: { entryId: string; updatedAt: number };
  theme: string;
  visualStyle: string;
  narrativeRhythm: string;
  sceneIntents: { sceneId: string; emotion: string; shotIntent: string; spatial: string }[];
  soundDirection: string;
  transitions: string;
  derivedAssetPlan: {
    parentAssetId: string;
    state: string;
    reason: string;
    toonflowAssetsId?: number;
    toonflowDerivedAssetId?: number;
    imageWorkflowId?: string;
  }[];
}

export interface DerivedAsset {
  id: string;
  parentAssetId: string;
  state: string;
  desc: string;
  imageRef: string | null;
}

export interface SeriesBible {
  id: string;
  projectId: string;
  characterLocks: { characterId: string; appearance: string; voiceId: string | null }[];
  sceneLocks: string[];
  visualManualId: string;
  directorManualId: string;
  aspectRatio: string;
  stylePositioning: string;
}

export interface EpisodeOutline extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  beats: { sceneIndex: number; location: string; beat: string; durationSec: number }[];
}
