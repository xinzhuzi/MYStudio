// 分镜镜头的场景解析(按名称找场景行、时段判定、优先选用带状态的场景行)。2026-11-24 超线文件拆分:从 storyboard-canonical-context.ts 拆出;原文件仍是入口,对外导出不变。

import { CANONICAL_TIME_OF_DAY_FAMILIES, type CanonicalSceneFact } from "@/lib/studio/storyboard-canonical-prompt";
import { splitCompoundAssetName } from "@/lib/studio/storyboard-frame-prompt";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProjectStore } from "@/stores/project/project-store";
import type { StoryboardItem } from "@/types/studio";
import type { Scene } from "@/stores/library/scene-store";

/** 名单匹配(复合资产名「李先生;管事」拆段+双向包含,与资产解析层同口径)。
 * 1120 件三导出:设计卡全文注入模块的绑定↔身份段名匹配复用同一口径。 */
export function nameMatches(query: string, candidateName: string): boolean {
  const q = query.trim();
  const name = candidateName.trim();
  if (!q || !name) return false;
  if (q === name || name.includes(q) || q.includes(name)) return true;
  return splitCompoundAssetName(q).some((part) => name.includes(part));
}

/** 三库场景行匹配(复合名拆段+双向包含;scene 落地驱动与场景事实共用)。 */
export function findSceneRowForNames(names: string[]): Scene | null {
  if (!names.length) return null;
  const projectId = useProjectStore.getState().activeProjectId;
  const scenes = useSceneStore
    .getState()
    .scenes.filter((scene) => !projectId || !scene.projectId || scene.projectId === projectId);
  return scenes.find((scene) => names.some((name) => nameMatches(name, scene.name))) ?? null;
}

// ─── 1117 C2 G1:场景五级序解析 + 时辰五源序解析(剧情锚定主修) ─────────────
// 断链档案(B1/B4/B2,S8-S12 实弹定谳):①S12 associateAssetsIds 有金水塾馆 id
// (scene_…jew094y)而装配层只读名字→id 在名不在链断;②row.scene 落库丢弃;
//③「晏燎」子串误中「晏燎静室」(角色名⊂场景名双向包含的结构性误配);④
// scene.time 库内 0/493+行无 continuityState=时辰双路恒空,夜只散活在 prompt
// 首字/slug。五级序+五源序把两链接通;未知项仍不猜不写。

/** 五级序/五源序可解析的分镜子集(缺省全 undefined=各级自然跳过)。 */
export type StoryboardSceneResolvableShot = Partial<
  Pick<
    StoryboardItem,
    | "associateAssetsIds"
    | "associateAssetsNames"
    | "sceneName"
    | "timeOfDay"
    | "prompt"
    | "videoDesc"
    | "shotSemantics"
    | "continuityState"
    | "episodeId"
  >
>;

/** 查询词命中角色库者不得作场景名参与子串匹配(B4:晏燎→晏燎静室根除)。 */
export function isCharacterLibraryName(name: string): boolean {
  const projectId = useProjectStore.getState().activeProjectId;
  const library = useCharacterLibraryStore.getState().characters;
  return library.some(
    (entry) =>
      nameMatches(name, entry.name)
      && (!projectId || !entry.projectId || entry.projectId === projectId),
  );
}

export function projectScenes(): Scene[] {
  const projectId = useProjectStore.getState().activeProjectId;
  return useSceneStore
    .getState()
    .scenes.filter((scene) => !projectId || !scene.projectId || scene.projectId === projectId);
}

/** 场景行基础名(态行「金水塾馆·夜内态：…」→「金水塾馆」)。 */
export function sceneBaseName(name: string): string {
  return name.split("·")[0]?.trim() || name.trim();
}

/** 时辰词同义词族成员集(词不在任何族=仅自身;与门A同源族表)。 */
export function sceneTimeOfDaySynonyms(word: string): string[] {
  const trimmed = word.trim();
  if (!trimmed) return [];
  for (const members of Object.values(CANONICAL_TIME_OF_DAY_FAMILIES)) {
    if (members.includes(trimmed)) return [...members];
    if (members.some((member) => member.length >= 2 && trimmed.includes(member))) return [...members];
  }
  return [trimmed];
}

/** sceneViewpointId slug 时段 token(jinshui-shuguan-hall-night-v1→夜;存量行可回填)。 */
export const SLUG_TIME_TOKENS: Record<string, string> = {
  night: "夜",
  day: "日",
  noon: "日",
  dawn: "晨",
  morning: "晨",
  dusk: "暮",
  evening: "暮",
};

/** 全时辰族词全文探针(最早出现位优先,同位长词优先;命中=该词)。 */
export function probeTimeWord(text: string): string | undefined {
  const words = Object.values(CANONICAL_TIME_OF_DAY_FAMILIES).flat();
  let best: { word: string; index: number } | undefined;
  for (const word of words) {
    const index = text.indexOf(word);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && word.length > best.word.length)) {
      best = { word, index };
    }
  }
  return best?.word;
}

/**
 * 时辰五源序解析(1117 C2 B2 主修;纯函数消费 store,测试可注入态):
 * ㊠shot.timeOfDay(场头时辰落库,正路)→㊡continuityState.lighting(设计槽
 * 保位)→㊢sceneViewpointId slug 时段 token→㊣prompt/videoDesc 时辰词探针
 * (S9 首字「夜。」)→㊤场景行 time/态行名标记(夜内态/晨雾态)。
 */
export function resolveShotTimeOfDay(
  shot: StoryboardSceneResolvableShot,
  sceneRow?: Scene | null,
): string | undefined {
  // ㊠ 新字段(正路:剧本场头「夜/内」→分镜表场头「｜时辰:夜·内」→落库)。
  const direct = shot.timeOfDay?.trim();
  if (direct) return direct;
  // ㊡ 设计槽保位(存量行无 continuityState=自然跳过)。
  const lighting = shot.continuityState?.lighting?.trim();
  if (lighting) {
    const probed = probeTimeWord(lighting);
    if (probed) return probed;
  }
  // ㊢ slug 时段 token(-night-→夜;视觉连续性域既有真源回填)。
  const slug = shot.shotSemantics?.sceneViewpointId?.trim();
  if (slug) {
    for (const segment of slug.split(/[-_]/)) {
      const token = SLUG_TIME_TOKENS[segment.toLowerCase()];
      if (token) return token;
    }
  }
  // ㊣ 画面文本时辰词探针(S9 prompt 首字「夜。」;videoDesc 同查)。
  const text = [shot.videoDesc, shot.prompt].filter(Boolean).join("\n");
  if (text) {
    const probed = probeTimeWord(text);
    if (probed) return probed;
  }
  // ㊤ 场景行 time/态行名标记(夜内态/晨雾态)。
  if (sceneRow) {
    if (sceneRow.time?.trim()) {
      const probed = probeTimeWord(sceneRow.time);
      if (probed) return probed;
    }
    const suffix = sceneRow.name.split("·").slice(1).join("·");
    if (suffix) {
      const probed = probeTimeWord(suffix);
      if (probed) return probed;
    }
  }
  return undefined;
}

/** 态行优选(㊄):同名基础行与「·夜内态」派生行并存时按时辰选态行(带图态行在册实证 mp381wo)。 */
export function preferSceneStateRow(row: Scene, timeOfDay: string | undefined, scenes: Scene[]): Scene {
  const base = sceneBaseName(row.name);
  if (row.name === base && !timeOfDay) return row;
  const synonyms = timeOfDay ? sceneTimeOfDaySynonyms(timeOfDay) : [];
  const siblings = scenes.filter((scene) => scene.name !== row.name && sceneBaseName(scene.name) === base);
  if (!siblings.length) return row;
  // 时辰已知:挑态名(·后段)含时辰族词的派生行;未知/无匹配=基础行。
  for (const sibling of siblings) {
    const suffix = sibling.name.split("·").slice(1).join("·");
    if (suffix && synonyms.some((word) => suffix.includes(word))) return sibling;
  }
  return row;
}

export interface ResolvedStoryboardScene {
  /** 态行优选后的三库行(null=五级序全断)。 */
  row: Scene | null;
  fact: CanonicalSceneFact | null;
  source: "asset-id" | "scene-name-field" | "text-probe" | "name-match" | null;
  timeOfDay?: string;
  warnings: string[];
}

/**
 * 场景五级序解析(1117 C2 B1/B4 主修):
 * ㊠associateAssetsIds scene_ 前缀 id 精确命中(S12 金水塾馆 id 在行而未被读)
 * →㊡sceneName 新字段(分镜表场景列落库)→㊢prompt/videoDesc 场名探针(三库
 * 行名 includes,回填 S8/S9)→㊣名匹配+守卫(角色库命中查询词不作场景名,
 * 晏燎⊂晏燎静室根除)→㊤态行优选(按时辰选「·夜内态」派生行)。
 */
export function resolveStoryboardScene(shot: StoryboardSceneResolvableShot): ResolvedStoryboardScene {
  const warnings: string[] = [];
  const scenes = projectScenes();
  let row: Scene | null = null;
  let source: ResolvedStoryboardScene["source"] = null;

  // ㊠ id 精确命中(associateAssetsIds 的 scene_ 前缀)。
  const sceneIds = (shot.associateAssetsIds ?? []).filter((id) => id.startsWith("scene_"));
  if (sceneIds.length) {
    row = scenes.find((scene) => sceneIds.includes(scene.id)) ?? null;
    if (row) source = "asset-id";
  }
  // ㊡ sceneName 新字段(精确名优先,复合名双向包含兜底)。
  if (!row) {
    const sceneName = shot.sceneName?.trim();
    if (sceneName) {
      row = scenes.find((scene) => scene.name === sceneName)
        ?? scenes.find((scene) => nameMatches(sceneName, scene.name)) ?? null;
      if (row) source = "scene-name-field";
    }
  }
  // ㊢ 画面文本场名探针(三库行名 includes 文本;多命中取最长名=最具体)。
  if (!row) {
    const text = [shot.videoDesc, shot.prompt].filter(Boolean).join("\n");
    if (text) {
      const hits = scenes
        .filter((scene) => scene.name.trim().length >= 2 && text.includes(scene.name.trim()))
        .sort((left, right) => right.name.trim().length - left.name.trim().length);
      if (hits.length) {
        row = hits[0]!;
        source = "text-probe";
      }
    }
  }
  // ㊣ 名匹配+角色守卫(B4:查询词命中角色库者不得作场景名)。
  if (!row) {
    const guardedNames = (shot.associateAssetsNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => !isCharacterLibraryName(name));
    const excluded = (shot.associateAssetsNames ?? []).filter((name) => isCharacterLibraryName(name));
    if (excluded.length) warnings.push(`scene-query-guarded:${excluded.join("、")}`);
    row = findSceneRowForNames(guardedNames);
    if (row) source = "name-match";
  }

  // 时辰(㊤源含行内标记)→态行优选(㊄)。
  const timeOfDay = resolveShotTimeOfDay(shot, row);
  const finalRow = row ? preferSceneStateRow(row, timeOfDay, scenes) : null;
  if (finalRow !== row && finalRow) warnings.push(`scene-state-row:${sceneBaseName(row!.name)}→${finalRow.name}`);

  const fact: CanonicalSceneFact | null = finalRow
    ? {
        name: finalRow.name,
        location: finalRow.location || undefined,
        time: timeOfDay || finalRow.time || undefined,
        atmosphere: finalRow.atmosphere || undefined,
      }
    : null;
  return { row: finalRow, fact, source, ...(timeOfDay ? { timeOfDay } : {}), warnings };
}
