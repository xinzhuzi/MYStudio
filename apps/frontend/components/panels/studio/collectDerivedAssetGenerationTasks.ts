// 衍生资产生成任务的收集(角色变体任务类型、提示词构造、任务收集)。2026-11-24 超线文件拆分:从 useProductionPlanningActions.ts 拆出;原文件仍是入口,导出名不变。

import { EXTENDED_VISUAL_MANUAL_SEED_ID } from "@/lib/studio/visual-manual-classification";
import type { AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import type { EntityResolver } from "@/lib/studio/derived-asset-sync";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import type { ScriptPlan } from "@/types/studio";

export type CharacterVariationGenerationTask = {
  characterId: string;
  variationId: string;
  projectId: string;
  name: string;
  prompt: string;
  referenceImages?: string[];
  imageWorkflowId?: string;
};

export function buildCharacterDerivativeImagePrompt(input: {
  characterName: string;
  variationName: string;
  basePrompt: string;
  reason: string;
  visualManualId: string;
}) {
  const basePrompt = input.basePrompt.trim() || `${input.variationName}：${input.reason}`.trim();
  const styleLock =
    input.visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID
      ? [
          "道劫彩色工笔水墨角色设定：媒介规则优先于父图的数字渲染，脸、手、发丝、衣褶与服饰结构先以连续白描和铁线描建立，再以矿物薄层分染与罩染；主体密、背景疏",
          "水墨为主、按角色与场景设定事实彩色点缀（色量仅作人工审稿观察，30%-70%不是生成硬门），只用石青、石绿、靛青、赭石、朱砂或旧金等2-3种低饱和点缀色，禁止整图灰白化或满幅鲜艳；浅净哑光平涂底、柔和均匀平光与纸面散射光",
          "低视觉噪点，denoised details，clear readable surfaces，smooth matte finish，controlled ink wash；衣袍完整可穿，整袖口整下摆闭合缝线",
          "负面约束：dirty/muddy texture，compression artifacts/jpeg artifacts，oversharpening halos，random stains，paper-wrinkle texture，crumpled-sheet folds，fiber streaks，tattered clothing，ragged hems",
          "禁止写实摄影，禁止3D写实渲染，CGI，赛璐璐平涂，高饱和霓虹，电影级体积雾，HDR高光，镜面湿面反光和全幅冷青或灰蓝渲染",
        ]
      : [
          "character reference sheet, character turnaround",
          "consistent identity, face consistency, outfit detail clarity",
        ];

  return [
    basePrompt,
    `角色衍生资产：${input.characterName} · ${input.variationName}`,
    "以父角色基础形象图为参考，保持同一角色身份、面容、体态、发型识别点不变，只叠加服化妆造与局部状态变化",
    "必须输出角色四视图设定图/三视图参考图，不要生成单张全身插画或说明卡",
    "同一画面左至右并排展示人像特写、正视图、侧视图、后视图，portrait closeup, front view, side view, back view, character reference sheet, character turnaround",
    "自然站立，宣纸白底色背景，均匀散光，无硬阴影，四视图服化妆造一致，图中不要有任何文字",
    ...styleLock,
  ].join("\n");
}

export function collectDerivedAssetGenerationTasks(
  plan: ScriptPlan["derivedAssetPlan"],
  resolver: EntityResolver,
  visualManualId: string,
  projectId: string,
  chapterId?: string,
): {
  characterVariationTasks: CharacterVariationGenerationTask[];
  storeTasks: AssetGenerationTask[];
  total: number;
  /** D4(design §2):resolver 匹配不到的计划条目明细——原 `if (!target) continue`
   * 静默丢,现计数+明细上报,调用方汇总提示「N 项派生资产未匹配到目标」。 */
  unmatched: Array<{ parentAssetId: string; state: string }>;
} {
  const characters = useCharacterLibraryStore.getState().characters;
  const scenes = useSceneStore.getState().scenes;
  const props = usePropsLibraryStore.getState().items;
  const characterVariationTasks: CharacterVariationGenerationTask[] = [];
  const storeTasks: AssetGenerationTask[] = [];
  const unmatched: Array<{ parentAssetId: string; state: string }> = [];

  for (const item of plan) {
    const target = resolver(item.parentAssetId);
    if (!target) {
      // D4:不再静默丢——留痕上报。
      unmatched.push({ parentAssetId: item.parentAssetId, state: item.state });
      continue;
    }

    if (target.kind === "character") {
      const character = characters.find((current) => current.id === target.id);
      const variation = character?.variations.find(
        (current) => current.name === item.state,
      );
      if (!character || !variation || variation.referenceImage) continue;
      characterVariationTasks.push({
        characterId: character.id,
        variationId: variation.id,
        projectId,
        name: `${character.name}-${variation.name}`,
        prompt: buildCharacterDerivativeImagePrompt({
          characterName: character.name,
          variationName: variation.name,
          basePrompt:
            variation.visualPromptZh ||
            variation.visualPrompt ||
            `${variation.name}：${item.reason}`,
          reason: item.reason,
          visualManualId,
        }),
        referenceImages: [
          character.thumbnailUrl,
          character.views[0]?.imageUrl,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: variation.imageWorkflowId,
      });
      continue;
    }

    if (target.kind === "scene") {
      const parentScene = scenes.find((current) => current.id === target.id);
      const scene = scenes.find(
        (current) =>
          current.parentSceneId === target.id &&
          current.viewpointName === item.state &&
          current.projectId === projectId,
      );
      if (!scene || scene.referenceImage) continue;
      const existingPrompt = scene.visualPrompt || `${item.state}：${item.reason}`;
      storeTasks.push({
        assetId: scene.id,
        assetType: "scene",
        projectId,
        chapterId,
        name: scene.name,
        description:
          [scene.location, scene.time, scene.atmosphere, scene.notes]
            .filter(Boolean)
            .join("，") || item.reason,
        isDerivative: true,
        visualManualId,
        skipPolish: Boolean(scene.visualPrompt),
        existingPrompt,
        referenceImages: [
          parentScene?.referenceImage,
          parentScene?.referenceImageBase64,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: scene.imageWorkflowId,
      });
      continue;
    }

    const parentProp = props.find((current) => current.id === target.id);
    const prop = props.find(
      (current) =>
        current.parentId === target.id &&
        current.category === item.state &&
        current.projectId === projectId,
    );
    if (!prop || prop.imageUrl) continue;
    const existingPrompt = prop.visualPrompt || `${item.state}：${item.reason}`;
    storeTasks.push({
      assetId: prop.id,
      assetType: "prop",
      projectId,
      chapterId,
      name: prop.name,
      description: prop.description || item.reason,
      isDerivative: true,
      visualManualId,
      skipPolish: Boolean(prop.visualPrompt),
      existingPrompt,
      referenceImages: [
        parentProp?.imageUrl,
        ...(parentProp?.referenceImages ?? []),
      ].filter((image): image is string => Boolean(image)),
      imageWorkflowId: prop.imageWorkflowId,
    });
  }

  return {
    characterVariationTasks,
    storeTasks,
    total: characterVariationTasks.length + storeTasks.length,
    unmatched,
  };
}
